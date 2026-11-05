// The Sessions tab (sessions you recorded): those still on this phone (uploading, or waiting to try again) above the
// ones uploaded, by month. Each is named for when it was, in your own time ("Last night", "Saturday afternoon"), and
// its bar is coloured tune by tune, as the Pixel's Recorder colours music and speech, and as the live waveform did. Opening one, as the iPhone's RecordingPage: the session as a strip of its tunes to scrub
// and play back from, and what was played, in sets, each tune with its first bars and its full score.
package com.tunecompanion.app

import androidx.compose.foundation.Canvas
import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.RecordingDetail
import com.tunecompanion.app.designsystem.TuneType
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.LocalRecording
import com.tunecompanion.app.api.RecordingSegment
import com.tunecompanion.app.api.RecordingSummary
import com.tunecompanion.app.api.TuneHeard
import com.tunecompanion.app.api.displayTitle
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.launch
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/** The recording open in the tab; kept here so it is still open after reading a tune's score from it. */
private var opened by mutableStateOf<RecordingSummary?>(null)
/** Where to start playing the recording just opened, if somewhere in particular. */
private var startAt by mutableStateOf<Long?>(null)

/** Opens a session (from Me's biggest night). */
fun openSession(id: String, recordedAt: String) {
    opened = RecordingSummary(id, sessionDate(recordedAt).substringBefore(","), recordedAt)
    startAt = null
}

/** Opens a recording at the moment a tune was heard in it (from the deck's tune world). */
fun openRecordingAt(heard: TuneHeard) {
    opened = RecordingSummary(heard.recordingId, heard.title, heard.recordedAt)
    startAt = heard.startMs
}

@Composable
fun RecordingsLayer(bottomPadding: Dp, onRead: (Reading) -> Unit) {
    opened?.let { summary ->
        RecordingScreen(summary, bottomPadding, onBack = { opened = null; startAt = null }, onRead = onRead)
        return
    }
    val library by Library.state.collectAsStateWithLifecycle()
    val pending by RecordingUploads.pending.collectAsStateWithLifecycle()
    val status by RecordingUploads.status.collectAsStateWithLifecycle()
    val landed by RecordingUploads.landed.collectAsStateWithLifecycle()
    var recordings by remember { mutableStateOf<List<RecordingSummary>?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() { if (library.user != null) recordings = runCatching { Services.api.recordings() }.getOrNull() ?: recordings ?: emptyList() }
    LaunchedEffect(library.user, landed) { load() }

    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottomPadding + 16.dp)) {
            item { Text("Sessions", style = MaterialTheme.typography.displaySmall, modifier = Modifier.statusBarsPadding().padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) }
            item {
                Text(if ((recordings?.size ?: 0) + pending.size == 0) "The sessions you record, with every tune that was played."
                    else "Every tune you heard, ready to play back and practise.",
                    style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current(), modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp))
            }
            if (pending.isNotEmpty()) item { MonthHeading("On this phone") }
            items(pending, key = { "local-${it.id}" }) { local -> PendingRow(local, status[local.id], signedIn = library.user != null) }
            when {
                library.user == null -> item { Welcome("Sign in to keep your sessions", "Record a night at the pub and every tune is named as it's played. Sign in and the setlist is here afterwards, to play back and practise at home.") }
                recordings == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                recordings!!.isEmpty() && pending.isEmpty() -> item { Welcome("No sessions yet", "Next time the tunes start, pull the deck all the way up and tap record. Every tune is named as it's played, and the setlist waits for you here.") }
                else -> recordings!!.groupBy { monthOf(it.recordedAt) }.forEach { (month, inMonth) ->
                    item("month-$month") { MonthHeading(month) }
                    items(inMonth, key = { it.id }) { r -> SessionCard(r) { opened = r } }
                }
            }
        }
    }
}

/** A session on this phone: uploading, saved, or waiting to try again. */
@Composable
private fun PendingRow(local: LocalRecording, status: RecordingUploads.Status?, signedIn: Boolean) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(sessionName(local.recordedAt), style = TuneType.title)
        val named = local.tunes.count { !it.rejected }
        val said = when (status) {
            is RecordingUploads.Status.Sending -> "Uploading, ${(status.progress * 100).toInt()}%"
            RecordingUploads.Status.Saving -> "Saving the setlist"
            RecordingUploads.Status.Done -> "Uploaded"
            is RecordingUploads.Status.Failed -> "Couldn't upload: ${status.message}"
            null -> if (signedIn) "Not uploaded yet" else "On this phone. Sign in to keep it."
        }
        Text("${length(local.durationMs)}, ${if (named == 1) "1 tune" else "$named tunes"}. $said", style = MaterialTheme.typography.bodySmall,
            color = if (status is RecordingUploads.Status.Failed) Palette.danger.current() else Palette.text3.current())
        // While it uploads the bar fills with its progress; the tunes' colours show beneath.
        val progress = (status as? RecordingUploads.Status.Sending)?.progress
        SegmentBar(local.durationMs, local.tunes.filter { !it.rejected }.map { RecordingSegment(it.tuneId, it.startMs, it.endMs) }, Modifier.padding(top = 6.dp), progress)
        if (status == null || status is RecordingUploads.Status.Failed) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (signedIn) TextButton({ RecordingUploads.upload(local) }) { Text(if (status == null) "Upload" else "Try again") }
            TextButton({ RecordingUploads.discard(local) }) { Text("Discard", color = Palette.danger.current()) }
        }
    }
    HorizontalDivider(Modifier.padding(start = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * The recording's length as a line, each named tune's stretch in its colour (in turn, as the session's waveform gave them),
 * the rest grey. [progress], if given, shows how much of it has uploaded.
 */
@Composable
fun SegmentBar(durationMs: Long, segments: List<RecordingSegment>, modifier: Modifier = Modifier, progress: Float? = null) {
    val palette = sessionPalette()
    val track = Palette.border.current()
    val ink = Palette.brandInk.current()
    val order = remember(segments) { segments.map { it.tuneId }.distinct() }
    Canvas(modifier.fillMaxWidth().height(4.dp)) {
        val y = size.height / 2
        val stroke = size.height
        fun x(ms: Long) = if (durationMs <= 0) 0f else (ms.toFloat() / durationMs).coerceIn(0f, 1f) * size.width
        drawLine(track, Offset(0f, y), Offset(size.width, y), stroke, StrokeCap.Round)
        for (segment in segments) {
            val from = x(segment.startMs); val to = x(if (segment.endMs > segment.startMs) segment.endMs else durationMs)
            // A sliver of a gap between tunes, so a set's tunes read as separate.
            val gap = 1.5.dp.toPx()
            if (to - from > gap * 2) drawLine(palette[order.indexOf(segment.tuneId) % palette.size], Offset(from + gap, y), Offset(to - gap, y), stroke, StrokeCap.Round)
        }
        if (progress != null) drawLine(ink.copy(alpha = 0.55f), Offset(0f, y), Offset(size.width * progress, y), stroke, StrokeCap.Round)
    }
}

/** "Under a minute", "12 min" or "1 h 5 min", as the web says it. */
private fun length(ms: Long): String {
    val m = Math.round(ms / 60000.0).toInt()
    return when { m < 1 -> "Under a minute"; m < 60 -> "$m min"; else -> "${m / 60} h ${m % 60} min" }
}

/** The recording's audio, streamed from its signed URL, slowed down without changing pitch. */
@Stable
private class RecordingAudio(url: String) {
    private val player = MediaPlayer()
    var ready by mutableStateOf(false); private set
    var playing by mutableStateOf(false); private set
    var timeMs by mutableLongStateOf(0L); private set
    var durationMs by mutableLongStateOf(0L); private set
    var speed by mutableIntStateOf(100); private set
    var problem by mutableStateOf<String?>(null); private set

    init {
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        player.setOnPreparedListener { ready = true; durationMs = it.duration.toLong() }
        player.setOnCompletionListener { playing = false }
        player.setOnErrorListener { _, _, _ -> problem = "This session's audio wouldn't play."; playing = false; true }
        runCatching { player.setDataSource(url); player.prepareAsync() }.onFailure { problem = "This session's audio wouldn't play." }
    }

    fun toggle() = if (playing) pause() else play()

    fun play() {
        if (!ready) return
        // Setting the speed starts playback, so it is only set as playback starts.
        player.playbackParams = player.playbackParams.setSpeed(speed / 100f)
        player.start()
        playing = true
    }

    fun pause() { if (ready && player.isPlaying) player.pause(); playing = false }

    /** [precise] false while scrubbing: the nearest point that plays at once, so the finger never waits. */
    fun seek(ms: Long, precise: Boolean = true) {
        timeMs = ms
        if (ready) player.seekTo(ms, if (precise) MediaPlayer.SEEK_CLOSEST else MediaPlayer.SEEK_CLOSEST_SYNC)
    }

    fun changeSpeed(value: Int) {
        speed = value
        if (playing) player.playbackParams = player.playbackParams.setSpeed(value / 100f)
    }

    /** Follows playback; called each frame while playing. */
    fun tick() { if (ready && playing) timeMs = player.currentPosition.toLong() }

    fun release() { playing = false; player.release() }
}

/** A stretch with no tune named this long shows in the setlist: a chat, a song, a break. */
private const val GAP_MS = 45_000L
/** Tunes played straight after one another are a set; a longer stretch with none named starts a new one. */
private const val SET_BREAK_MS = 20_000L

private sealed interface SetlistRow {
    val key: String
    data class Gap(val from: Long, val to: Long) : SetlistRow { override val key get() = "gap-$from" }
    data class SetHead(val from: Long, val count: Int, val first: String) : SetlistRow { override val key get() = "set-$first" }
    data class Tune(val entry: RecordingDetail.Entry) : SetlistRow { override val key get() = entry.id }
}

/** Tunes played back to back, as groups of indexes into [tunes]. */
private fun sets(tunes: List<RecordingDetail.Entry>): List<List<Int>> {
    val sets = mutableListOf<MutableList<Int>>()
    var edge = Long.MIN_VALUE
    tunes.forEachIndexed { index, tune ->
        if (sets.isEmpty() || tune.startMs - edge > SET_BREAK_MS) sets += mutableListOf<Int>()
        sets.last() += index
        edge = maxOf(edge, tune.endMs)
    }
    return sets
}

/** The setlist as a timeline: each tune at its time, tunes played back to back marked as a set, and long stretches with none named. */
private fun rows(tunes: List<RecordingDetail.Entry>): List<SetlistRow> {
    val rows = mutableListOf<SetlistRow>()
    var last = 0L
    for (set in sets(tunes)) {
        val first = tunes[set.first()]
        if (first.startMs - last >= GAP_MS) rows += SetlistRow.Gap(last, first.startMs)
        if (set.size > 1) rows += SetlistRow.SetHead(first.startMs, set.size, first.id)
        for (index in set) { rows += SetlistRow.Tune(tunes[index]); last = maxOf(last, tunes[index].endMs) }
    }
    return rows
}

@Composable
private fun RecordingScreen(summary: RecordingSummary, bottomPadding: Dp, onBack: () -> Unit, onRead: (Reading) -> Unit) {
    BackHandler(onBack = onBack)
    var detail by remember(summary.id) { mutableStateOf<RecordingDetail?>(null) }
    var problem by remember(summary.id) { mutableStateOf<String?>(null) }
    var open by remember(summary.id) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val haptics = LocalHapticFeedback.current
    suspend fun load() {
        runCatching { Services.api.recording(summary.id) }
            .onSuccess { detail = it; problem = null }
            .onFailure { problem = it.message ?: "Couldn't load this session. Pull down to try again." }
    }
    LaunchedEffect(summary.id) { load() }
    val url = detail?.audioUrl
    val audio = remember(url) { url?.let { RecordingAudio(it) } }
    DisposableEffect(audio) { onDispose { audio?.release() } }
    // The score player behind would play over it.
    LaunchedEffect(audio?.playing) { if (audio?.playing == true) Player.current?.pause() }
    LaunchedEffect(audio, audio?.playing) { while (audio?.playing == true) withFrameMillis { audio.tick() } }
    LaunchedEffect(open) { if (open != null) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
    // Opened at a moment: there, its tune open in the setlist, once the audio can play.
    LaunchedEffect(audio?.ready, detail) {
        val at = startAt ?: return@LaunchedEffect
        val ready = audio?.ready == true
        detail?.tunes?.lastOrNull { at >= it.startMs && at < it.endMs }?.let { open = it.id }
        if (ready) { audio!!.seek(at); startAt = null }
    }

    val book = detail
    val colour = tuneColour(book?.tunes.orEmpty())
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = bottomPadding + 24.dp)) {
        item("title") {
            Column(Modifier.statusBarsPadding().padding(top = 8.dp)) {
                IconButton(onBack) { Icon(painterResource(R.drawable.ic_arrow_back), "Back") }
                Text(sessionName(summary.recordedAt), style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(horizontal = 20.dp))
                val tunes = book?.tunes.orEmpty()
                // The tune count waits for the setlist, rather than saying none while it loads.
                Text(listOfNotNull(sessionDate(summary.recordedAt), length(book?.durationMs ?: summary.durationMs?.toLong() ?: 0),
                    book?.let { tunes.map { it.tuneId }.distinct().size.let { if (it == 1) "1 tune" else "$it tunes" } }).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current(), modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            }
        }
        when {
            book == null && problem != null -> item("problem") {
                Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't open this session", style = MaterialTheme.typography.titleMedium)
                    Text(problem!!, color = Palette.text3.current(), textAlign = TextAlign.Center)
                    TextButton({ scope.launch { load() } }) { Text("Try again") }
                }
            }
            book == null -> item("loading") { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            else -> {
                item("deck") {
                    if (audio != null) PlaybackDeck(book, audio, open, colour, onPick = { open = it }, onLetGo = {
                        // The setlist's rows follow the title, the player and their heading.
                        val index = rows(book.tunes).indexOfFirst { it.key == open }
                        if (index >= 0) scope.launch { list.animateScrollToItem(index + 3, -200) }
                    })
                    else Text("This session has no audio.", color = Palette.text3.current(), modifier = Modifier.padding(20.dp))
                }
                item("played") { Text("What was played", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) }
                if (book.tunes.isEmpty()) item("none") { Text("No tunes were named in this session.", color = Palette.text3.current(), modifier = Modifier.padding(20.dp)) }
                items(rows(book.tunes), key = { it.key }) { row ->
                    when (row) {
                        is SetlistRow.Gap -> Text("${clock(row.from)}, no tune named for ${length(row.to - row.from).lowercase()}", style = MaterialTheme.typography.bodySmall,
                            color = Palette.text3.current(), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                        is SetlistRow.SetHead -> Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            RepeatMark(); Spacer(Modifier.width(8.dp))
                            Text("Set of ${row.count}, from ${clock(row.from)}", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
                        }
                        is SetlistRow.Tune -> EntryRow(row.entry, colour(row.entry.tuneId), open == row.entry.id, audio,
                            onToggle = { open = if (open == row.entry.id) null else row.entry.id },
                            onScore = { onRead(Reading(listOf(ReaderPage.of(row.entry.finderTune)), 0, editable = false)) },
                            onWrong = { scope.launch {
                                runCatching { Services.api.removeRecordingTune(summary.id, row.entry.id) }.onFailure { problem = "Could not take the tune off. Try again." }
                                open = null; load()
                            } })
                    }
                }
                item("actions") {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 16.dp)) {
                        if (book.tunes.isNotEmpty()) TextButton({
                            scope.launch {
                                busy = true
                                val name = "Session, ${summary.title}"
                                runCatching { Services.api.makeTunebook(name, book.tunes.map { it.settingId to it.savedId }, sets(book.tunes)) }
                                    .onSuccess { made = name; Library.load() }
                                    .onFailure { problem = "Could not make the tunebook. Try again." }
                                busy = false
                            }
                        }, enabled = !busy) {
                            Icon(painterResource(R.drawable.ic_tunes), null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                            Text(if (busy) "Making the tunebook" else "Make a tunebook of these")
                        }
                        made?.let { Text("Made \u201c$it\u201d. It's with your tunebooks in Tunes.", style = MaterialTheme.typography.bodySmall, color = Palette.success.current(), modifier = Modifier.padding(horizontal = 12.dp)) }
                        TextButton({ confirmDelete = true }, enabled = !busy) { Text("Delete this session", color = Palette.danger.current()) }
                        if (problem != null) Text(problem!!, color = Palette.danger.current(), modifier = Modifier.padding(horizontal = 12.dp))
                    }
                }
            }
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete this session?") },
        text = { Text("Its audio and setlist go for good.") },
        confirmButton = { TextButton({
            confirmDelete = false
            scope.launch {
                busy = true
                runCatching { Services.api.deleteRecording(summary.id) }
                    .onSuccess { RecordingUploads.landed(); onBack() }
                    .onFailure { problem = it.message ?: "Couldn't delete the session. Try again." }
                busy = false
            }
        }) { Text("Delete", color = Palette.danger.current()) } },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("Keep") } },
    )
}

/** Each tune's colour in a recording, in turn by when it was first played, as its bar and the live waveform gave them. */
@Composable
private fun tuneColour(tunes: List<RecordingDetail.Entry>): (Int) -> Color {
    val palette = sessionPalette()
    val order = remember(tunes) { tunes.sortedBy { it.startMs }.map { it.tuneId }.distinct() }
    return { id -> palette[order.indexOf(id).coerceAtLeast(0) % palette.size] }
}

/**
 * The player: what is playing now, the session as a strip of its tunes, and the controls. Touching the strip scrubs the
 * audio and picks the tune under the finger: its segment lifts while the rest fall back, and on release the setlist
 * scrolls to it, open.
 */
@Composable
private fun PlaybackDeck(detail: RecordingDetail, audio: RecordingAudio, open: String?, colour: (Int) -> Color, onPick: (String) -> Unit, onLetGo: () -> Unit) {
    val tunes = detail.tunes
    val duration = maxOf(audio.durationMs.takeIf { it > 0 } ?: detail.durationMs ?: 0L, 1L)
    // The tune that started most recently, where a setlist's tunes overlap.
    val current = tunes.lastOrNull { audio.timeMs >= it.startMs && audio.timeMs < it.endMs }
    val track = Palette.accent.current()
    val head = MaterialTheme.colorScheme.onSurface
    val lift by animateFloatAsState(if (open != null) 1f else 0f, spring(dampingRatio = 0.75f, stiffness = 500f), label = "lift")
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(current?.displayTitle ?: if (audio.timeMs > 0) "No tune named here" else " ", style = TuneType.trayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Canvas(Modifier.fillMaxWidth().height(36.dp).pointerInput(tunes, duration) {
            fun at(x: Float) = ((x / size.width).coerceIn(0f, 1f) * duration).toLong()
            fun pick(ms: Long) { tunes.lastOrNull { ms >= it.startMs && ms < it.endMs }?.let { if (it.id != open) onPick(it.id) } }
            awaitEachGesture {
                val down = awaitFirstDown()
                at(down.position.x).let { audio.seek(it, precise = false); pick(it) }
                var last = down.position.x
                drag(down.id) { change -> last = change.position.x; at(last).let { audio.seek(it, precise = false); pick(it) }; change.consume() }
                audio.seek(at(last))
                onLetGo()
            }
        }) {
            val middle = size.height / 2
            fun x(ms: Long) = size.width * (ms.toFloat() / duration).coerceIn(0f, 1f)
            val bar = 14.dp.toPx()
            drawRoundRect(track, Offset(0f, middle - bar / 2), Size(size.width, bar), CornerRadius(bar / 2))
            for (entry in tunes) {
                val picked = entry.id == open
                val h = if (picked) 26.dp.toPx() else if (open == null) 18.dp.toPx() else 14.dp.toPx() + 4.dp.toPx() * (1 - lift)
                // A picked tune shows at least a fingertip wide, even one the setlist gives almost no time.
                val w = maxOf(if (picked) 12.dp.toPx() else 3.dp.toPx(), x(entry.endMs) - x(entry.startMs) - 1.dp.toPx())
                val alpha = if (open == null) 0.9f else if (picked) 1f else 0.4f
                drawRoundRect(colour(entry.tuneId).copy(alpha = alpha), Offset(x(entry.startMs), middle - h / 2), Size(w, h), CornerRadius(4.dp.toPx()))
            }
            val now = x(audio.timeMs)
            drawRoundRect(head, Offset(now - 1.5.dp.toPx(), middle - 15.dp.toPx()), Size(3.dp.toPx(), 30.dp.toPx()), CornerRadius(1.5.dp.toPx()))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val ink = Palette.brandInk.current()
            Box(Modifier.size(48.dp).background(ink, CircleShape).clickable(enabled = audio.ready) { audio.toggle() }, contentAlignment = Alignment.Center) {
                if (!audio.ready && audio.problem == null) CircularProgressIndicator(Modifier.size(20.dp), color = Palette.onBrandInk.current(), strokeWidth = 2.dp)
                else Icon(painterResource(if (audio.playing) R.drawable.ic_pause else R.drawable.ic_play), if (audio.playing) "Pause" else "Play", tint = Palette.onBrandInk.current())
            }
            Spacer(Modifier.width(14.dp))
            Text("${clock(audio.timeMs)} / ${clock(duration)}", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = Palette.text3.current())
            Spacer(Modifier.weight(1f))
            SingleChoiceSegmentedButtonRow {
                listOf(75, 85, 100).forEachIndexed { i, value ->
                    SegmentedButton(audio.speed == value, { audio.changeSpeed(value) }, SegmentedButtonDefaults.itemShape(i, 3), icon = {}) { Text("$value%", style = MaterialTheme.typography.labelMedium) }
                }
            }
        }
        audio.problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.danger.current()) }
    }
}

@Composable
private fun EntryRow(entry: RecordingDetail.Entry, colour: Color, open: Boolean, audio: RecordingAudio?, onToggle: () -> Unit, onScore: () -> Unit, onWrong: () -> Unit) {
    val playing = audio != null && audio.playing && audio.timeMs >= entry.startMs && audio.timeMs < entry.endMs
    Column(Modifier.fillMaxWidth().animateContentSize(spring(stiffness = 500f))) {
        Row(Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(clock(entry.startMs), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = Palette.text3.current(), modifier = Modifier.width(48.dp))
            Box(Modifier.size(8.dp).background(colour, CircleShape)); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(entry.displayTitle, style = TuneType.trayTitle, color = if (playing) colour else MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOf(entry.meta, "${maxOf(1, (entry.endMs - entry.startMs) / 60000)} min").filter { it.isNotEmpty() }.joinToString(", "),
                    style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            }
            Spacer(Modifier.width(8.dp))
            Text(if (entry.savedId != null || entry.practice.level != Level.Unlearned) entry.practice.level.label else "New to you",
                style = MaterialTheme.typography.bodySmall, color = Palette.mutedForeground.current())
        }
        if (open) Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
            if (entry.abc.isNotBlank()) AbcView(Abc.openingPhrase(entry.title, entry.kind, entry.meter, entry.mode, entry.abc), AbcStyle.Phrase)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Button({ audio?.seek(entry.startMs); audio?.play() }, enabled = audio?.ready == true) {
                    Icon(painterResource(R.drawable.ic_play), null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Play from here")
                }
                TextButton(onScore) { Text("Full score") }
                TextButton(onWrong) { Text("Not this tune", color = Palette.danger.current()) }
            }
        }
    }
}

/** A month's heading in the list, as the Pixel's Recorder groups its recordings. */
@Composable
private fun MonthHeading(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 6.dp))
}

/** One uploaded session: when it was, how long, the tunes played, and its tune-coloured bar. */
@Composable
private fun SessionCard(r: RecordingSummary, onOpen: () -> Unit) {
    val duration = r.durationMs?.toLong() ?: 0
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp).clip(RoundedCornerShape(20.dp)).background(Palette.card.current())
        .clickable(onClick = onOpen).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(sessionName(r.recordedAt), style = TuneType.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(length(duration), style = MaterialTheme.typography.labelMedium, color = Palette.text3.current())
        }
        Text(listOf(sessionDate(r.recordedAt), if (r.tunes == 1) "1 tune" else if (r.tunes == 0) "no tunes named" else "${r.tunes} tunes").joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        if (r.tunes > 0) Text(r.firstTunes.joinToString(", ") { displayTitle(it) } + if (r.tunes > r.firstTunes.size) " and ${r.tunes - r.firstTunes.size} more" else "",
            style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        SegmentBar(duration, r.segments, Modifier.padding(top = 8.dp))
    }
}

/** The list's friendly first words: what this tab is, and how to fill it. */
@Composable
private fun Welcome(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(20.dp)).background(Palette.card.current()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(painterResource(R.drawable.ic_waveform), null, Modifier.size(28.dp), tint = micTint(1f).strong)
        Text(title, style = TuneType.title)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current())
    }
}

/**
 * A session named for when it was, in your own time: "This evening", "Last night", "Yesterday afternoon", "Saturday
 * morning". The small hours count as the night before.
 */
fun sessionName(iso: String, now: ZonedDateTime = ZonedDateTime.now()): String {
    val at = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()) }.getOrNull() ?: return "A session"
    val hour = at.hour
    val part = when (hour) { in 5..11 -> "morning"; in 12..16 -> "afternoon"; in 17..20 -> "evening"; else -> "night" }
    val day = (if (hour < 5) at.minusDays(1) else at).toLocalDate()
    val today = (if (now.hour < 5) now.minusDays(1) else now).toLocalDate()
    return when (ChronoUnit.DAYS.between(day, today)) {
        0L -> if (part == "night") "Tonight" else "This $part"
        1L -> if (part == "night") "Last night" else "Yesterday $part"
        else -> "${day.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.ENGLISH)} $part"
    }
}

/** "4 November, 7:24 pm" (with the year, from another year), so sessions on the same evening tell apart. */
fun sessionDate(iso: String): String {
    val at = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()) }.getOrNull() ?: return ""
    val pattern = if (at.year == ZonedDateTime.now().year) "d MMMM" else "d MMMM yyyy"
    return at.format(DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH)) + ", " +
        java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date.from(at.toInstant()))
}

/** "November", or "November 2025" from another year. */
private fun monthOf(iso: String): String {
    val at = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()) }.getOrNull() ?: return ""
    return at.format(DateTimeFormatter.ofPattern(if (at.year == ZonedDateTime.now().year) "MMMM" else "MMMM yyyy", Locale.ENGLISH))
}
