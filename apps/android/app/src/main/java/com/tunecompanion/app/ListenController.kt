// Drives listening for the whole app, as the web's useTuneListener and the iPhone's ListenModel:
// the microphone and model (core/listen), the haptics, the foreground service that keeps a session
// going with the screen off, the leader and other guesses, and the tunes heard tonight. Naming a
// tune stops at the first confident answer; recording a session keeps going and adds each new tune.
package com.tunecompanion.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.designsystem.Haptics
import com.tunecompanion.app.listen.FinderAssets
import com.tunecompanion.app.listen.FinderModel
import com.tunecompanion.app.listen.Listener
import com.tunecompanion.app.listen.ListenerEvent
import com.tunecompanion.app.listen.ModelRunner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.listen_ffi.ListenStatus

enum class Mode { NameTune, RecordSession }
enum class Phase { Listening, Narrowing, Named }

data class Heard(val tune: FinderTune, val at: Long)

data class ListenState(
    val live: Boolean = false,
    /** Asking for the microphone or loading the model, before audio flows. */
    val starting: Boolean = false,
    val mode: Mode = Mode.NameTune,
    val phase: Phase = Phase.Listening,
    /** Downloading the model on first use, 0 to 1; null once ready. */
    val downloading: Float? = null,
    val quiet: Boolean = false,
    /** How far the leader is ahead of what naming it needs, 0 to 1. */
    val confidence: Float = 0f,
    /** The finder's best guess, and whether it is sure. */
    val leader: FinderTune? = null,
    val leaderSure: Boolean = false,
    val alternatives: List<FinderTune> = emptyList(),
    /** Tonight's tunes, newest first. */
    val heard: List<Heard> = emptyList(),
    /** Why listening stopped, said plainly. */
    val problem: String? = null,
    val startedAt: Long = 0,
    /** A tune being kept (Learn later), by The Session tune ID. */
    val saving: Int? = null,
) {
    val recording: Boolean get() = live && mode == Mode.RecordSession
    /** The most recent tune named. */
    val current: FinderTune? get() = heard.firstOrNull()?.tune
    /** Tonight's tunes since the session began. */
    val tonight: List<Heard> get() = if (mode == Mode.RecordSession) heard.filter { it.at >= startedAt } else emptyList()
}

object ListenController {
    private const val TAG = "TuneCompanion"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(ListenState())
    val state: StateFlow<ListenState> = _state

    /** The input level, kept apart from [state] so it can change many times a second without recomposing everything. */
    private val _level = MutableStateFlow(0f)
    val level: StateFlow<Float> = _level

    /** Bumped whenever a tune is named, so the drawer can rise to show it. */
    private val _named = MutableStateFlow(0)
    val named: StateFlow<Int> = _named

    private lateinit var app: Context
    private lateinit var haptics: Haptics
    private var prepared: Pair<ModelRunner, FinderModel>? = null
    private var listener: Listener? = null
    private var run: Job? = null
    private val names = mutableMapOf<Int, FinderTune>()
    private var candidateIds: List<Int> = emptyList()

    fun start(context: Context, mode: Mode) {
        val s = _state.value
        if (s.live) {
            // Already listening for one tune: carry on as a session.
            if (mode == Mode.RecordSession && s.mode == Mode.NameTune) _state.update { it.copy(mode = Mode.RecordSession, startedAt = System.currentTimeMillis() - 1) }
            return
        }
        app = context.applicationContext
        if (!::haptics.isInitialized) haptics = Haptics(app)
        if (app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            _state.update { it.copy(problem = "Allow the microphone to listen") }
            return
        }
        _state.update {
            it.copy(live = true, starting = true, mode = mode, phase = Phase.Listening, quiet = false, confidence = 0f, problem = null,
                leader = null, leaderSure = false, alternatives = emptyList(), startedAt = System.currentTimeMillis())
        }
        ListenService.start(app)
        run = scope.launch { begin() }
    }

    fun stop() {
        run?.cancel()
        listener?.stop()
        listener = null
        _level.value = 0f
        _state.update { it.copy(live = false, starting = false, downloading = null) }
    }

    /** Forget the answer so far and listen afresh, keeping the audio. */
    fun restart() {
        listener?.reset()
        _state.update { it.copy(leader = null, leaderSure = false, alternatives = emptyList(), confidence = 0f, phase = Phase.Listening) }
    }

    /** A tune named wrongly leaves tonight's list, and listening carries on. */
    fun reject(heard: Heard) {
        _state.update { s -> s.copy(heard = s.heard.filter { it != heard }) }
        if (_state.value.leader?.tuneId == heard.tune.tuneId) restart()
    }

    fun clearHeard() = _state.update { it.copy(heard = emptyList()) }

    /** One tap in the pub: save the tune and mark it Want to learn. A level already set stays. */
    fun learnLater(tune: FinderTune) = scope.launch {
        val settingId = tune.settingId ?: return@launch
        _state.update { it.copy(saving = tune.tuneId) }
        try {
            val savedId = tune.savedId ?: Services.api.saveSetting(settingId)
            var kept = tune.copy(savedId = savedId)
            if ((tune.level ?: Level.Unlearned) == Level.Unlearned) {
                Services.api.setLevel(savedId, Level.Wanted)
                kept = kept.copy(level = Level.Wanted)
            }
            update(kept)
            if (::haptics.isInitialized) haptics.confidenceTick(1f)
            Library.load()
        } catch (cause: Exception) {
            Log.e(TAG, "Learn later failed", cause)
        } finally {
            _state.update { it.copy(saving = null) }
        }
    }

    /** A tune's new standing, everywhere it shows. */
    private fun update(tune: FinderTune) {
        names[tune.tuneId] = tune
        _state.update { s ->
            s.copy(
                heard = s.heard.map { if (it.tune.tuneId == tune.tuneId) it.copy(tune = tune) else it },
                leader = if (s.leader?.tuneId == tune.tuneId) tune else s.leader,
                alternatives = s.alternatives.map { if (it.tuneId == tune.tuneId) tune else it },
            )
        }
    }

    private suspend fun begin() {
        try {
            val (runner, model) = prepare()
            if (!_state.value.live) return
            val listener = Listener(app, runner, model) { event -> scope.launch { handle(event) } }
            listener.start(scope)
            this.listener = listener
            _state.update { it.copy(starting = false) }
            Log.i(TAG, "Listening with ${model.tuneIds.size} tunes, ${runner.channels} channels")
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            Log.e(TAG, "Could not start listening", cause)
            _state.update { it.copy(problem = "The tune finder stopped") }
            stop()
        }
    }

    /** The model, downloaded on first use and loaded once per process. */
    private suspend fun prepare(): Pair<ModelRunner, FinderModel> {
        prepared?.let { return it }
        val assets = FinderAssets(app)
        _state.update { it.copy(downloading = 0f) }
        try {
            val model = assets.load { progress -> _state.update { it.copy(downloading = progress) } }
            val runner = withContext(Dispatchers.Default) { ModelRunner(model.modelFile) }
            scope.launch { assets.refreshIfChanged() }
            return (runner to model).also { prepared = it }
        } finally {
            _state.update { it.copy(downloading = null) }
        }
    }

    private suspend fun handle(event: ListenerEvent) {
        if (!_state.value.live) return
        when (event) {
            // RMS of a few tenths is loud music close by; the halo saturates there.
            is ListenerEvent.Level -> _level.value = (event.rms * 5f).coerceAtMost(1f)
            ListenerEvent.Quiet -> _state.update { it.copy(quiet = true) }
            is ListenerEvent.Failed -> Log.e(TAG, "Scoring failed: ${event.message}")
            is ListenerEvent.Verdict -> {
                val verdict = event.verdict
                val confidence = (verdict.margin / 0.04).coerceIn(0.0, 1.0).toFloat()
                candidateIds = verdict.candidates.take(5).map { it.tuneId.toInt() }
                scope.launch { lookUp(candidateIds) }
                refreshGuesses(verdict.status == ListenStatus.MATCH)
                when (verdict.status) {
                    ListenStatus.LISTENING, ListenStatus.UNSURE -> {
                        _state.update { s ->
                            // In a session the last tune stays on screen until the next one is named.
                            if (s.recording && s.tonight.isNotEmpty()) s.copy(quiet = false, confidence = confidence)
                            else s.copy(quiet = false, confidence = confidence, phase = if (verdict.status == ListenStatus.LISTENING) Phase.Listening else Phase.Narrowing)
                        }
                        if (!_state.value.recording && verdict.status == ListenStatus.UNSURE) haptics.confidenceTick(confidence)
                    }
                    ListenStatus.MATCH -> candidateIds.firstOrNull()?.let { named(it, confidence) }
                }
            }
        }
    }

    /** The leader and the other guesses, from the latest verdict's candidates. */
    private fun refreshGuesses(sure: Boolean) {
        val leader = candidateIds.firstOrNull()?.let { names[it] }
        _state.update { s ->
            s.copy(leader = leader ?: s.leader, leaderSure = if (leader != null) sure else s.leaderSure, alternatives = candidateIds.drop(1).mapNotNull { names[it] })
        }
    }

    /** A confident answer: a new tune joins tonight's list (a set moving on), the same one is ignored. */
    private suspend fun named(tuneId: Int, confidence: Float) {
        lookUp(listOf(tuneId))
        val tune = names[tuneId] ?: return
        val s = _state.value
        if (!s.live) return
        refreshGuesses(true)
        if (s.heard.firstOrNull()?.tune?.tuneId == tuneId && s.recording) return
        val first = s.tonight.isEmpty() || s.mode == Mode.NameTune
        _state.update { it.copy(phase = Phase.Named, confidence = confidence, quiet = false, heard = listOf(Heard(tune, System.currentTimeMillis())) + it.heard) }
        if (first) haptics.lockOn() else haptics.setChange()
        _named.value++
        if (s.mode == Mode.NameTune) stop()
    }

    private suspend fun lookUp(ids: List<Int>) {
        val missing = ids.filter { it !in names }
        if (missing.isNotEmpty()) runCatching { Services.api.finderTunes(missing) }.onSuccess { tunes -> tunes.forEach { names[it.tuneId] = it } }
        refreshGuesses(_state.value.leaderSure)
    }

}
