// The app's two layers. Behind: the music layer (your tunes and tunebooks, recordings, scores, and Me).
// In front: the deck, floating over the music at three heights, always about what is behind it. Over your
// tunes it is the microphone: down is standby, half names a tune, full is a session. Over a score it is
// the score's player: half is practice, full the tune's world. A session recording keeps it the session,
// red and glowing, whatever is behind, until Stop. The layers are one physical thing: as the deck rises
// the music settles back (smaller, dimmer, softer), and it follows the deck, so a tune just named
// opens its score behind it and a session builds tonight's setlist there. All on one value that
// follows the finger and settles on springs.
package com.tunecompanion.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.lerp
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.api.SavedTune
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

enum class Height { Head, Half, Full }

/** Where the listening drawer is: one offset (px from the top) that the finger moves and springs settle. */
@Stable
class DrawerPosition(private val scope: CoroutineScope) {
    var offset by mutableFloatStateOf(Float.NaN)
        private set
    var anchors by mutableStateOf(mapOf<Height, Float>())
    private var settling: Job? = null

    private val head get() = anchors[Height.Head] ?: 0f
    private val full get() = anchors[Height.Full] ?: 0f

    /** Where half up falls on [progress]. */
    val halfProgress: Float get() = anchors[Height.Half]?.let { half -> if (head == full) 0.5f else ((head - half) / (head - full)).coerceIn(0f, 1f) } ?: 0.5f

    /** 0 with only the head showing, 1 fully open. */
    val progress: Float get() = if (offset.isNaN() || head == full) 0f else ((head - offset) / (head - full)).coerceIn(0f, 1f)

    val at: Height get() = anchors.minByOrNull { abs(it.value - offset) }?.key ?: Height.Head

    /** Moves with the finger; past the top or bottom height it gives less and less. */
    fun drag(delta: Float): Float {
        settling?.cancel()
        val before = offset
        val next = offset + delta
        offset = when {
            next < full -> full - rubber(full - next)
            next > head -> head + rubber(next - head)
            else -> next
        }
        return offset - before
    }

    private fun rubber(distance: Float) = distance * 60f / (60f + distance) * 1.2f

    /** Springs to the height a flick (px per second, down positive) is heading for. */
    fun settle(velocity: Float = 0f) {
        val projected = offset + velocity * 0.18f
        val target = when {
            abs(velocity) > 1600f -> anchors.entries.filter { if (velocity > 0) it.value > offset + 1 else it.value < offset - 1 }
                .minByOrNull { abs(it.value - offset) }?.key ?: at
            else -> anchors.minByOrNull { abs(it.value - projected) }?.key ?: Height.Head
        }
        go(target, velocity, byHand = true)
    }

    /** The height it last came to rest at. */
    var rested by mutableStateOf(Height.Head)
        private set

    /** Told each time it comes to rest at a new height: where, from where, and whether a person moved it (not the app). */
    var onRest: (to: Height, from: Height, byHand: Boolean) -> Unit = { _, _, _ -> }

    fun go(target: Height, velocity: Float = 0f, byHand: Boolean = false) {
        val to = anchors[target] ?: return
        settling?.cancel()
        settling = scope.launch {
            animate(offset, to, velocity, spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)) { value, _ -> offset = value }
            val from = rested
            rested = target
            if (from != target) onRest(target, from, byHand)
        }
    }

    fun place(anchors: Map<Height, Float>) {
        val was = at
        this.anchors = anchors
        if (offset.isNaN()) offset = anchors[Height.Head] ?: 0f else anchors[was]?.let { offset = it }
    }

    /** Lets a list inside the drawer scroll it: up opens the drawer before the list moves; down at the list's top closes it. */
    val nestedScroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset =
            if (available.y < 0 && offset > full + 0.5f) Offset(0f, drag(maxOf(available.y, full - offset))) else Offset.Zero

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset =
            if (available.y > 0 && source == NestedScrollSource.UserInput) Offset(0f, drag(available.y)) else Offset.Zero

        override suspend fun onPreFling(available: Velocity): Velocity {
            val between = anchors.values.none { abs(it - offset) < 1f }
            return if (between) { settle(available.y); available } else Velocity.Zero
        }
    }
}

/** What the music layer shows: a tab, a reading (a tune's score, or a list's), or tonight's setlist while a session records. */
private sealed interface Backdrop {
    data class Tab(val index: Int) : Backdrop
    data class Read(val reading: Reading) : Backdrop
    data object Tonight : Backdrop
}

@Composable
fun AppShell(onListen: (Mode) -> Unit) {
    var tab by rememberSaveable { mutableStateOf(0) }
    var reading by remember { mutableStateOf<Reading?>(null) }
    val scope = rememberCoroutineScope()
    val drawer = remember { DrawerPosition(scope) }
    val listen by ListenController.state.collectAsStateWithLifecycle()
    val named by ListenController.named.collectAsStateWithLifecycle()
    val library by Library.state.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val top = WindowInsets.statusBars.getTop(density)
    val bottomInset = WindowInsets.navigationBars.getBottom(density)

    // The deck is the microphone: down is standby, half arms naming a tune, full arms a session. Moving it never starts or
    // stops the microphone, as on the web: the mic's button does, so nothing listens or records by accident, and folding
    // the deck leaves whatever is going on going (its head shows Stop).
    drawer.onRest = { _, _, _ -> haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
    // Listening started from the folded deck (its mic, the tile) lifts it to show what it hears; a session opens it fully.
    LaunchedEffect(listen.live, listen.recording) {
        // The microphone would hear the score playing.
        if (listen.live) Player.current?.pause()
        when {
            listen.recording -> { reading = null; drawer.go(Height.Full) }
            listen.live && drawer.rested == Height.Head -> drawer.go(Height.Half)
        }
    }
    // A tune just named shows in the deck, and its score opens in the music layer behind it: pull the deck down and
    // you are reading the tune you just heard. In a session, the music layer is tonight's setlist instead.
    LaunchedEffect(named) {
        if (named == 0) return@LaunchedEffect
        if (drawer.rested == Height.Head) drawer.go(Height.Half)
        val tune = ListenController.state.value.leader ?: return@LaunchedEffect
        if (!ListenController.state.value.recording) reading = readingFor(tune, library.tunes)
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val height = with(density) { maxHeight.toPx() }
        val tabs = with(density) { 80.dp.toPx() } + bottomInset
        val head = with(density) { 84.dp.toPx() }
        // Full is one more step up, as in Polarsteps, not the whole screen: the top of the music layer stays in sight,
        // so it never feels like a new page.
        val full = maxOf(top + with(density) { 56.dp.toPx() }, height * 0.15f)
        LaunchedEffect(height, top, tabs) {
            drawer.place(mapOf(
                Height.Full to full,
                Height.Half to height * 0.42f,
                Height.Head to height - tabs - head,
            ))
        }
        val p = drawer.progress
        val bottom = with(density) { (tabs + head).toDp() }
        val openScore: (FinderTune) -> Unit = { tune -> reading = readingFor(tune, library.tunes); drawer.go(Height.Head) }

        // Behind: the music layer. It settles back as the deck rises: a little smaller, rounded, softer and dimmer.
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    val s = 1f - 0.07f * p
                    scaleX = s; scaleY = s
                    translationY = -12.dp.toPx() * p
                    shape = RoundedCornerShape((28 * p).dp)
                    clip = true
                }
                .blur((8 * p).dp)
                .background(MaterialTheme.colorScheme.background),
        ) {
            val backdrop = reading?.let { Backdrop.Read(it) } ?: if (listen.recording) Backdrop.Tonight else Backdrop.Tab(tab)
            AnimatedContent(
                targetState = backdrop,
                transitionSpec = { (fadeIn(tween(220)) + scaleIn(initialScale = 0.98f)) togetherWith (fadeOut(tween(160)) + scaleOut(targetScale = 1.02f)) },
                contentKey = { if (it is Backdrop.Read) "read" else it },
                label = "music",
            ) { shown ->
                when (shown) {
                    is Backdrop.Read -> key(shown.reading) { ReaderScreen(shown.reading, bottomPadding = bottom, onClose = { reading = null }) }
                    Backdrop.Tonight -> TonightLayer(listen, bottomPadding = bottom, onOpen = openScore)
                    is Backdrop.Tab -> when (shown.index) {
                        0 -> TunesLayer(bottomPadding = bottom, onRead = { reading = it; drawer.go(Height.Head) })
                        1 -> RecordingsLayer(bottomPadding = bottom, onRead = { reading = it; drawer.go(Height.Head) })
                        else -> MeLayer(bottomPadding = bottom, onRead = { reading = it; drawer.go(Height.Head) },
                            onSession = { night -> openSession(night.id, night.recordedAt); tab = 1; drawer.go(Height.Head) })
                    }
                }
            }
        }
        // The dimming, which also folds the deck away when tapped.
        if (p > 0.01f) Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f * p))
                .clickable(remember { MutableInteractionSource() }, indication = null) { drawer.go(Height.Head, byHand = true) },
        )

        // In front: the deck. It takes on the colour of what it is: green while it names a tune, warming to red as it rises
        // to a session, and red while one records; over a score, the brand ink of the score's player.
        val open = ((p - drawer.halfProgress) / (1f - drawer.halfProgress)).coerceIn(0f, 1f)
        val lit by animateFloatAsState(if (listen.live) 1f else 0f, tween(400), label = "lit")
        val practising = Player.current != null && !listen.live
        val deckColor = if (practising) lerp(MaterialTheme.colorScheme.surfaceContainer, Palette.brandInkSoft.current(), 0.7f * minOf(1f, p * 1.6f))
            else lerp(MaterialTheme.colorScheme.surfaceContainer, micTint(if (listen.recording) 1f else open).soft, 0.6f * maxOf(lit, open))
        // Recording, a red glow breathes along the deck's top edge, whatever is behind it.
        val glow by animateFloatAsState(if (listen.recording) 1f else 0f, tween(600), label = "glow")
        if (glow > 0f) {
            val breath by rememberInfiniteTransition(label = "breath").animateFloat(0.55f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "breath")
            val red = Palette.danger.current()
            val reach = with(density) { 64.dp.toPx() }
            Box(Modifier
                .offset { IntOffset(0, ((if (drawer.offset.isNaN()) height else drawer.offset) - reach).roundToInt()) }
                .fillMaxWidth().height(with(density) { (reach + 40.dp.toPx()).toDp() })
                .graphicsLayer { alpha = glow * breath }
                .background(Brush.verticalGradient(0f to Color.Transparent, 0.62f to red.copy(alpha = 0.32f), 1f to red.copy(alpha = 0.5f))))
        }
        Surface(
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            color = deckColor,
            modifier = Modifier
                .offset { IntOffset(0, if (drawer.offset.isNaN()) height.roundToInt() else drawer.offset.roundToInt()) }
                .fillMaxWidth()
                .height(with(density) { (height - full).toDp() })
                .shadow(16.dp, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), clip = false,
                    ambientColor = lerp(Color.Black, Palette.danger.current(), glow), spotColor = lerp(Color.Black, Palette.danger.current(), glow))
                .draggable(
                    rememberDraggableState { drawer.drag(it) },
                    Orientation.Vertical,
                    onDragStopped = { velocity -> drawer.settle(velocity) },
                ),
        ) {
            ListenDrawer(listen, drawer, onListen, tabsHeight = with(density) { tabs.toDp() }, onScore = openScore, onHeard = { heard ->
                // The moment you heard it: its recording, opened there, in the Recordings tab.
                openRecordingAt(heard)
                tab = 1; reading = null; drawer.go(Height.Head)
            })
        }

        // The tabs stay put beneath the deck while it moves.
        NavigationBar(Modifier.align(Alignment.BottomCenter).zIndex(2f), containerColor = MaterialTheme.colorScheme.surface) {
            // Selection is brand-ink (settled); brand-dot orange is kept for what is live.
            val colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.primary)
            val choose = { index: Int -> tab = index; reading = null; drawer.go(Height.Head) }
            val onTab = reading == null && !listen.recording
            NavigationBarItem(onTab && tab == 0, { choose(0) }, { Icon(painterResource(R.drawable.ic_tunes), null) }, label = { Text("Tunes") }, colors = colors)
            NavigationBarItem(onTab && tab == 1, { choose(1) }, { Icon(painterResource(R.drawable.ic_waveform), null) }, label = { Text("Sessions") }, colors = colors)
            NavigationBarItem(onTab && tab == 2, { choose(2) }, { Icon(painterResource(R.drawable.ic_person), null) }, label = { Text("Me") }, colors = colors)
        }
    }
}

/** A tune to read behind the deck: yours, among your tunes; otherwise The Session's setting on its own. */
private fun readingFor(tune: FinderTune, mine: List<SavedTune>): Reading {
    val index = mine.indexOfFirst { it.id == tune.savedId }
    if (index >= 0) return Reading(mine.map { ReaderPage(it, null, it.id) }, index)
    return Reading(listOf(ReaderPage.of(tune)), 0, editable = false)
}

/** The Tune Companion mark, from the same geometry as apps/web/src/app/icon.svg. */
@Composable
fun BrandMark(modifier: Modifier = Modifier) {
    val dot = Palette.brandDot.current()
    val ink = Palette.brandInk.current()
    Canvas(modifier) {
        val s = size.minDimension / 100f
        fun x(v: Float) = (v - 1) * s
        for (cy in listOf(40f, 60f)) drawCircle(dot, 6.5f * s, Offset(x(18f), cy * s))
        drawRoundRect(ink, Offset(x(28f), 17 * s), Size(7.5f * s, 66 * s), CornerRadius(3.75f * s))
        val tick = androidx.compose.ui.graphics.Path().apply { moveTo(x(46.5f), 47 * s); lineTo(x(54f), 76.5f * s); lineTo(x(86f), 23.5f * s) }
        drawPath(tick, ink, style = Stroke(13 * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
