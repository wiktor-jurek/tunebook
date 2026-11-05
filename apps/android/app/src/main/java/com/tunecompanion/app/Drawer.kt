// What the listening drawer holds, as the web's deck and the iPhone's tray and deck: the head (the
// mic and what it is doing), a named tune's answer with its opening bars and other close matches,
// the record button (or, recording, the live setlist), quick search and tonight's tunes. Half up shows
// the single tune; the session panel fades in as the deck rises to full.
package com.tunecompanion.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateOffsetAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.TuneHeard
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.delay

@Composable
fun ListenDrawer(listen: ListenState, drawer: DrawerPosition, onListen: (Mode) -> Unit, tabsHeight: Dp, onScore: (FinderTune) -> Unit, onHeard: (TuneHeard) -> Unit) {
    val library by Library.state.collectAsStateWithLifecycle()
    val signedIn = library.user != null
    // The answer shows once a tune is named (or the best guess once listening stops); in a session the setlist shows it.
    val answer = listen.leader?.takeIf { !listen.recording && (listen.leaderSure || !listen.live) }
    // One microphone, carried by the deck: it sits in the head; lifted to half it grows into the big green button that names
    // a tune, and on to full it swings up into the session's red record button (as the web's deck does). Moving the deck
    // only arms it: listening and recording start and stop with a tap. The head, the naming panel and the recorder hold
    // empty slots for it.
    val slots = remember { MicSlots() }
    val half = drawer.halfProgress
    val toHalf = (drawer.progress / half).coerceIn(0f, 1f)
    val grow = ((drawer.progress - half) / (1f - half)).coerceIn(0f, 1f)
    // A score open behind the deck makes it the practice deck: its head the score's player, its panels practice and the
    // tune's world. Listening takes it back (and a session keeps it, red, the whole time it records).
    val player = Player.current?.takeIf { !listen.live }
    // A tune just named still shows its answer above practice, until the deck is folded to read it.
    val named by ListenController.named.collectAsStateWithLifecycle()
    var read by remember { mutableIntStateOf(-1) }
    LaunchedEffect(drawer.rested, player) { if (player != null && drawer.rested == Height.Head) read = named }
    Box(Modifier.fillMaxSize().onPlaced { slots.root = it }) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp, 4.dp).clip(CircleShape).background(MaterialTheme.colorScheme.outline))
            }
            AnimatedContent(player, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(150)) }, label = "head") { playing ->
                if (playing != null) PlayerHead(playing) { onListen(Mode.NameTune) } else Head(listen, drawer, Modifier.micSlot(slots) { mini = it }, words = (1 - toHalf * 1.8f).coerceIn(0f, 1f), session = grow > 0.5f)
            }
            // Half up is the single-tune panel; the session panel fades in as the deck rises past it to full, and stays while a session records.
            val fullness = if (listen.recording) 1f else grow
            LazyColumn(
                Modifier.weight(1f).nestedScroll(drawer.nestedScroll),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = tabsHeight + 32.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                if (player != null) {
                    if (answer != null && read != named) item("answer") { Answer(answer, listen, signedIn, onScore, onRead = { drawer.go(Height.Head, byHand = true) }) }
                    item("practice") { PracticePanel(player) }
                    if (grow > 0.01f) item("world") { Box(Modifier.alpha(grow)) { TuneWorld(player, onHeard) } }
                    return@LazyColumn
                }
                if (!listen.recording) item("name") {
                    Box(Modifier.alpha(1 - grow).collapse(grow)) { NamePanel(listen, answer != null, Modifier.micSlot(slots) { mid = it }) { slots.mid = null } }
                }
                if (answer != null) item("answer") { Answer(answer, listen, signedIn, onScore, onRead = { drawer.go(Height.Head, byHand = true) }) }
                if (fullness <= 0.01f) return@LazyColumn
                item("record") { Box(Modifier.alpha(fullness)) { Recorder(listen, signedIn, Modifier.micSlot(slots) { big = it }) } }
                if (listen.recording) {
                    if (listen.tonight.isEmpty()) item("waiting") { Text("Listening for the first tune", color = Palette.text3.current(), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                    items(listen.tonight, key = { "${it.tune.tuneId}-${it.at}" }) { heard -> SetlistItem(heard, now = heard == listen.tonight.first(), tuneColours(listen.tonight)(heard.tune.tuneId), onScore) }
                } else {
                    item("search") { Box(Modifier.alpha(fullness)) { Search(onScore) } }
                    if (listen.heard.isNotEmpty()) item("heard") { Box(Modifier.alpha(fullness)) { HeardList(listen, onScore) } }
                }
            }
        }
        val big = grow > 0.5f
        // As recording starts, the button glides from the middle to the top left and shrinks into Stop.
        val bigAt by animateOffsetAsState(slots.big ?: slots.mid ?: slots.mini, spring(dampingRatio = 0.8f, stiffness = 380f), label = "big")
        val bigSize by animateDpAsState(if (listen.recording) LIVE else BIG, spring(dampingRatio = 0.8f, stiffness = 380f), label = "size")
        // Practising, the deck is no microphone: the player's own mic button is the way back to listening.
        if (player == null) Dial(listen, size = MINI, grow = grow,
            modifier = Modifier
                .offset {
                    // Head to half, then half to full, each in a curve: rising first, then drifting across.
                    val mini = slots.mini; val mid = slots.mid ?: mini; val big = if (slots.big != null) bigAt else mid
                    // Recording, Stop's place beside the waveform shows from half up, so it goes straight there.
                    val (a, b, t) = when {
                        listen.recording && slots.big != null -> Triple(mini, bigAt, toHalf)
                        grow > 0f -> Triple(mid, big, grow)
                        else -> Triple(mini, mid, toHalf)
                    }
                    val curveX = t * t; val curveY = 1 - (1 - t) * (1 - t)
                    val x = a.x + (b.x - a.x) * curveX; val y = a.y + (b.y - a.y) * curveY
                    IntOffset((x - MINI.toPx() / 2).roundToInt(), (y - MINI.toPx() / 2).roundToInt())
                }
                .graphicsLayer {
                    val s = when {
                        listen.recording && slots.big != null -> 1f + (bigSize / MINI - 1f) * toHalf
                        grow > 0f -> 1f + (BIG / MINI - 1f) * (1 - grow) * (if (slots.mid != null) 1f else 0f) + (bigSize / MINI - 1f) * grow
                        else -> 1f + (BIG / MINI - 1f) * (if (slots.mid != null) toHalf else 0f)
                    }
                    scaleX = s; scaleY = s
                },
        ) {
            when {
                big -> if (listen.recording) ListenController.stop() else onListen(Mode.RecordSession)
                listen.recording -> drawer.go(Height.Full)
                listen.live -> ListenController.stop()
                else -> onListen(Mode.NameTune)
            }
        }
    }
}

/** Gives up its height as [by] runs 0 to 1, so what follows moves up into its place. */
private fun Modifier.collapse(by: Float) = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    layout(placeable.width, (placeable.height * (1 - by)).roundToInt()) { placeable.place(0, 0) }
}

private val MINI = 52.dp
private val BIG = 88.dp
/** The Stop button beside the waveform while a session records. */
private val LIVE = 68.dp

/** Where the deck's microphone sits folded ([mini]), at half ([mid], naming a tune) and full ([big], recording): slot centres within the deck. */
private class MicSlots {
    var root: LayoutCoordinates? = null
    var mini by mutableStateOf(Offset.Zero)
    var mid by mutableStateOf<Offset?>(null)
    var big by mutableStateOf<Offset?>(null)
}

private fun Modifier.micSlot(slots: MicSlots, set: MicSlots.(Offset) -> Unit) = onGloballyPositioned { here ->
    val root = slots.root?.takeIf { it.isAttached } ?: return@onGloballyPositioned
    if (here.isAttached) slots.set(root.localPositionOf(here, Offset(here.size.width / 2f, here.size.height / 2f)))
}

/** The drawer's head: the mic, what it is doing, and a hint; tapping the words opens or folds the drawer. */
@Composable
private fun Head(listen: ListenState, drawer: DrawerPosition, micSlot: Modifier, words: Float, session: Boolean) {
    val now = listen.tonight.firstOrNull()?.tune
    val status = when {
        listen.recording -> now?.displayTitle ?: "Listening for a tune"
        listen.downloading != null -> "Loading the tune model, ${(listen.downloading * 100).toInt()}%"
        listen.live && listen.starting -> "Asking for the microphone"
        listen.problem != null -> listen.problem
        listen.live -> if (listen.quiet) "Too quiet, move closer" else "Listening"
        listen.leader != null -> "Tap to name another tune"
        else -> "What's playing?"
    }
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(listen.recording) { while (listen.recording) { tick = System.currentTimeMillis(); delay(1000) } }
    val hint = when {
        listen.recording -> "Live ${clock(tick - listen.startedAt)}, ${listen.tonight.size} ${if (listen.tonight.size == 1) "tune" else "tunes"}"
        listen.live -> null
        else -> "Tap the mic, or pull up for more"
    }
    Row(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(micSlot.size(MINI))
                Spacer(Modifier.width(14.dp))
                // Its words make way as the mic rises out of the head into the panel below.
                Column(Modifier.weight(1f).alpha(words).clickable { drawer.go(if (drawer.at == Height.Head) Height.Half else Height.Head, byHand = true) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (listen.recording) { RecordingDot(); Spacer(Modifier.width(8.dp)) }
                        Text(status, style = if (listen.recording && now != null) TuneType.trayTitle else MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (listen.live && !listen.recording && !listen.quiet && !listen.starting && listen.downloading == null) { Spacer(Modifier.width(6.dp)); HoppingDots() }
                    }
                    if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), maxLines = 1)
                }
            }
            // Open, the head names the panel instead (as the web's deck title does).
            if (words < 1f) AnimatedContent(when { listen.recording -> "Live session"; session -> "Record a session"; else -> "Name a tune" },
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "title", modifier = Modifier.alpha(1f - words)) { title ->
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 4.dp))
            }
        }
        // Points up while the drawer rests at its head, down once it is open: it flips, never stops sideways.
        val flip by animateFloatAsState(if (drawer.progress > 0.25f) 180f else 0f, spring(dampingRatio = 0.7f), label = "chevron")
        Icon(painterResource(R.drawable.ic_chevron_up), if (drawer.progress > 0.25f) "Fold the drawer" else "Open", Modifier.size(24.dp).rotate(flip)
            .clickable { drawer.go(if (drawer.at == Height.Head) Height.Half else Height.Head, byHand = true) }, tint = Palette.text3.current())
    }
}

/**
 * Half up: naming one tune. The big green mic in the middle (the deck's mic settles into its slot), and beneath it what
 * to do or what it is doing; the answer follows below.
 */
@Composable
private fun NamePanel(listen: ListenState, answered: Boolean, micSlot: Modifier, onGone: () -> Unit) {
    DisposableEffect(Unit) { onDispose(onGone) }
    val (status, detail) = when {
        listen.downloading != null -> "Loading the tune model, ${(listen.downloading * 100).toInt()}%" to "Only the first time. It stays on your phone."
        listen.live && listen.starting -> "Asking for the microphone" to null
        listen.problem != null -> listen.problem to "Tap the mic to try again."
        listen.live -> (if (listen.quiet) "Too quiet, move closer" else "Listening") to "Hold the phone near the music. Most tunes are named within 20 seconds."
        answered -> "Tap to name another tune" to null
        else -> "Tap to name the tune that's playing" to "Or pull up all the way to record a whole session."
    }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(micSlot.size(BIG))
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(status, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
            if (listen.live && !listen.quiet && !listen.starting && listen.downloading == null) { Spacer(Modifier.width(6.dp)); HoppingDots() }
        }
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp).widthIn(max = 320.dp))
    }
}

@Composable
private fun RecordingDot() {
    val blink by rememberInfiniteTransition(label = "blink").animateFloat(1f, 0.25f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "dot")
    val dot = micTint(1f).strong
    Canvas(Modifier.size(9.dp)) { drawCircle(dot.copy(alpha = blink)) }
}

/** The web's two hopping dots after "Listening". */
@Composable
private fun HoppingDots() {
    val hop = rememberInfiniteTransition(label = "hop")
    val dot = micTint(0f).strong
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (i in 0..1) {
            val y by hop.animateFloat(0f, 1f, infiniteRepeatable(tween(500, delayMillis = i * 180), RepeatMode.Reverse), label = "y$i")
            Canvas(Modifier.size(6.dp).padding(top = 0.dp)) { drawCircle(dot.copy(alpha = 0.55f + 0.45f * y), center = Offset(center.x, center.y - 5.dp.toPx() * y)) }
        }
    }
}

/** A named tune: whether it is sure, the title as people say it, where it stands for you, and how it starts. */
@Composable
private fun Answer(tune: FinderTune, listen: ListenState, signedIn: Boolean, onScore: (FinderTune) -> Unit, onRead: () -> Unit) {
    var others by remember(tune.tuneId) { mutableStateOf(false) }
    // Its score already open behind the deck, the head is that score's player and names it: no need to say it twice.
    val behind = !listen.live && Player.current?.tuneId == tune.tuneId
    Column(Modifier.fillMaxWidth().animateContentSize(spring(stiffness = 400f)), horizontalAlignment = Alignment.CenterHorizontally) {
        if (!listen.leaderSure) Text("Possible match", style = MaterialTheme.typography.labelLarge, color = micTint(0f).strong)
        if (!behind) {
            Text(tune.displayTitle, fontFamily = FontFamily.Serif, fontSize = 32.sp, lineHeight = 36.sp, textAlign = TextAlign.Center)
            Text(tune.meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        }
        if (tune.standingSentence.isNotEmpty()) Text(tune.standingSentence, style = MaterialTheme.typography.bodySmall,
            color = if (tune.isKnown) Palette.brandInk.current() else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (tune.isKnown) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.padding(top = 4.dp))
        tune.abc?.let { AbcView(Abc.openingPhrase(tune.title, tune.kind, tune.meter, tune.mode, it), AbcStyle.Phrase, Modifier.padding(top = 12.dp)) }
        if (tune.savedId == null) Text("Opening bars of The Session's setting, not a transcription", style = MaterialTheme.typography.labelSmall, color = Palette.text3.current())
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            // Folding the deck reveals the score behind it; a tune not open there opens first.
            Button({ if (behind) onRead() else onScore(tune) }) { Text("Read it") }
            LearnLater(tune, listen, signedIn)
        }
        if (listen.alternatives.isNotEmpty()) {
            if (listen.leaderSure) TextButton({ others = !others }) { Text(if (others) "Hide other matches" else "Not it?") }
            AnimatedVisibility(others || !listen.leaderSure) {
                Column(Modifier.fillMaxWidth()) {
                    Text(if (listen.leaderSure) "Other close matches" else "Or it could be", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
                    listen.alternatives.take(if (listen.leaderSure) 4 else 2).forEach { alt ->
                        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
                        FinderRow(alt, alt.meta, onScore, phrase = true)
                    }
                    if (listen.live) TextButton({ ListenController.restart(); others = false }) { Text("Listen again from here") }
                }
            }
        }
    }
}

/** One tap to keep a tune for later: saved and marked Want to learn. Nothing for a tune already known. */
@Composable
private fun LearnLater(tune: FinderTune, listen: ListenState, signedIn: Boolean) {
    when {
        tune.isKnown -> Unit
        tune.level == Level.Wanted -> Text("On your list", color = Palette.brandInk.current(), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(12.dp))
        signedIn -> OutlinedButton({ ListenController.learnLater(tune) }, enabled = listen.saving != tune.tuneId) {
            Text(if (listen.saving == tune.tuneId) "Saving" else "Learn later")
        }
        else -> Unit
    }
}

@Composable
private fun FinderRow(tune: FinderTune, detail: String, onScore: (FinderTune) -> Unit, phrase: Boolean = false) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(tune.displayTitle, style = TuneType.trayTitle)
                Text(detail, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            }
            TextButton({ onScore(tune) }) { Text("Score") }
        }
        if (phrase) tune.abc?.let { AbcView(Abc.openingPhrase(tune.title, tune.kind, tune.meter, tune.mode, it), AbcStyle.Phrase) }
    }
}

/**
 * The session panel's recorder, laid out like a recorder app: armed, the big button in the middle (the deck's mic settles
 * into its slot) and what it does; recording, Stop at the top left with the waveform and the clock beside it.
 */
@Composable
private fun Recorder(listen: ListenState, signedIn: Boolean, micSlot: Modifier) {
    // Recording, Stop moves to the top left with the waveform and clock beside it (as the web's live deck), leaving the
    // rest of the deck to tonight's tunes.
    if (listen.recording) {
        var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
        LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Spacer(micSlot.size(LIVE))
            Spacer(Modifier.width(24.dp))
            // The waveform only exists while recording: it grows in beside Stop as the session starts.
            val shown = remember { MutableTransitionState(false) }.apply { targetState = true }
            AnimatedVisibility(shown, Modifier.weight(1f), enter = fadeIn(tween(300)) + expandHorizontally(tween(420), expandFrom = Alignment.Start)) {
                SessionWave(listen, barsHeight = 52.dp, clock = clock(now - listen.startedAt))
            }
        }
        return
    }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(micSlot.size(BIG))
        Spacer(Modifier.height(22.dp))
        Text(if (signedIn) "Records the whole session and names each tune as it goes. Tap any tune for its music."
            else "Names each tune as the session goes, into tonight's list. Sign in to keep your tunes.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 320.dp))
    }
}

/** A live session's tune: the one playing now shows its opening bars; swipe one away if it was named wrongly. */
@Composable
private fun SetlistItem(heard: Heard, now: Boolean, colour: Color, onScore: (FinderTune) -> Unit) {
    val dismiss = rememberSwipeToDismissBoxState()
    LaunchedEffect(dismiss.currentValue) { if (dismiss.currentValue != SwipeToDismissBoxValue.Settled) ListenController.reject(heard) }
    SwipeToDismissBox(dismiss, backgroundContent = {}) {
        Column(Modifier.fillMaxWidth().clickable { onScore(heard.tune) }) {
            if (now) Text("Now playing", style = MaterialTheme.typography.labelLarge, color = colour)
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Its colour in the waveform above.
                Box(Modifier.size(8.dp).background(colour, CircleShape)); Spacer(Modifier.width(10.dp))
                Text(heard.tune.displayTitle, style = TuneType.title)
            }
            Text(heard.tune.meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            if (now) heard.tune.abc?.let { AbcView(Abc.openingPhrase(heard.tune.title, heard.tune.kind, heard.tune.meter, heard.tune.mode, it), AbcStyle.Phrase, Modifier.padding(top = 8.dp)) }
        }
    }
}

/** For a tune someone names out loud; results show exactly like a heard tune. */
@Composable
private fun Search(onScore: (FinderTune) -> Unit) {
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<FinderTune>?>(null) }
    LaunchedEffect(query) {
        val text = query.trim()
        if (text.length < 2) { found = null; return@LaunchedEffect }
        delay(250)
        found = runCatching { Services.api.searchTunes(text) }.getOrDefault(emptyList())
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Quick search", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
        TextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search scores by tune name") }, singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = TextFieldDefaults.colors(focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                focusedContainerColor = Palette.muted.current(), unfocusedContainerColor = Palette.muted.current()))
        found?.let { tunes ->
            if (tunes.isEmpty()) Text("No tune by that name on The Session.", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            tunes.forEach { FinderRow(it, it.meta, onScore) }
        }
    }
}

/** Tonight's tunes, each once with when it was last heard, and a recap of how many you already know. */
@Composable
private fun HeardList(listen: ListenState, onScore: (FinderTune) -> Unit) {
    val unique = listen.heard.groupBy { it.tune.tuneId }.values.map { it.first() to it.size }
    val format = remember { java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Heard", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
        if (unique.size > 1) {
            val known = unique.count { it.first.tune.isKnown }
            Text("You heard ${unique.size} tunes. You can play along with $known.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        unique.forEach { (heard, times) ->
            FinderRow(heard.tune, listOfNotNull(heard.tune.meta, format.format(java.util.Date(heard.at)), if (times > 1) "$times times" else null).joinToString(", "), onScore)
        }
        TextButton({ ListenController.clearHeard() }) { Text("Clear") }
    }
}

/** m:ss or h:mm:ss. */
fun clock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0); val h = s / 3600; val m = s / 60 % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s % 60) else "%d:%02d".format(m, s % 60)
}
