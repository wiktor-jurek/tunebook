// The reader, as the phone's web SessionBook and the iPhone's Reader: a list's tunes as full-screen
// scores, swiped through. The bar says where you are ("3 of 12", which lists every tune to jump to)
// and finds one by name. Each page is the tune's set (if any), its title and meta, where it stands
// for you (set here, for your own tunes) and its score. The screen stays on: the phone is propped on
// a music stand or a pint glass. It opens in the music layer, behind the deck.
package com.tunecompanion.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.BackHandler
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.PlayalongTrack
import com.tunecompanion.app.api.Practice
import com.tunecompanion.app.api.SavedTune
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.launch

/** One page of the reader: a tune, the set it is played in (if any), and an ID unique in its list. */
data class ReaderPage(val tune: SavedTune, val set: String?, val id: String, val note: String? = null) {
    companion object {
        /** A tune the finder named or found that is not in your library: The Session's setting, read as it is. */
        fun of(tune: FinderTune) = ReaderPage(
            SavedTune(tune.savedId ?: "session-${tune.tuneId}", tune.tuneId, tune.settingId ?: 0, tune.title, null, tune.kind, tune.meter, tune.mode,
                tune.abc.orEmpty(), Practice(tune.level ?: Level.Unlearned)),
            null, "session-${tune.tuneId}",
            if (tune.savedId != null) "Your setting of this tune." else "The Session's first setting of this tune. Other settings are on The Session.",
        )
    }
}

/** A list's tunes to read, opened at one of them. */
data class Reading(
    val pages: List<ReaderPage>,
    val at: Int,
    val editable: Boolean = true,
    /** Play-along recordings by setting ID, when the list already has them (a tunebook); otherwise each page fetches its own. */
    val playalongs: Map<Int, List<PlayalongTrack>>? = null,
    val defaultSound: Int? = null,
)

/** The reader, in the music layer: the deck stays in front of it, and back closes it. */
@Composable
fun ReaderScreen(reading: Reading, bottomPadding: Dp, onClose: () -> Unit) {
    val pages = reading.pages
    val pager = rememberPagerState(initialPage = reading.at.coerceIn(0, (pages.size - 1).coerceAtLeast(0))) { pages.size }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var jumping by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    LaunchedEffect(pager.settledPage) { if (pager.settledPage != reading.at) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
    BackHandler(onBack = onClose)
    val view = LocalView.current
    DisposableEffect(view) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }

    Surface(Modifier.fillMaxSize(), color = Palette.card.current()) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClose) { Icon(painterResource(R.drawable.ic_close), "Close") }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    if (pages.size > 1) {
                        TextButton({ jumping = true }) {
                            Text("${pager.currentPage + 1} of ${pages.size}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                        }
                        DropdownMenu(jumping, { jumping = false }) {
                            pages.forEachIndexed { index, page ->
                                DropdownMenuItem(
                                    { Text(page.tune.displayTitle, fontWeight = if (index == pager.currentPage) FontWeight.SemiBold else FontWeight.Normal) },
                                    { jumping = false; scope.launch { pager.scrollToPage(index) } },
                                )
                            }
                        }
                    }
                }
                if (pages.size > 1) IconButton({ searching = true }) { Icon(painterResource(R.drawable.ic_search), "Find a tune") }
                else Spacer(Modifier.width(48.dp))
            }
            // Neighbours are drawn ready, so a swipe lands on a score already laid out.
            HorizontalPager(pager, Modifier.weight(1f), beyondViewportPageCount = 1, key = { pages[it].id }) { index ->
                ScorePage(pages[index], reading, current = index == pager.settledPage, bottomPadding)
            }
        }
    }
    if (searching) ReaderSearch(pages, onPick = { scope.launch { pager.scrollToPage(it) } }, onDismiss = { searching = false })
}

@Composable
private fun ScorePage(page: ReaderPage, reading: Reading, current: Boolean, bottomPadding: Dp) {
    val editable = reading.editable && !page.tune.id.startsWith("session-")
    val context = LocalContext.current
    val playback = remember(page.id) {
        ScorePlayback(page.tune.title, page.tune.tuneId, page.tune.meter, reading.defaultSound, context).also { it.tune = page.tune; it.editable = editable }
    }
    // The playback holds the tune, so a level set from the deck's practice panel shows here too.
    val tune = playback.tune ?: page.tune
    // Only the page on screen plays; the deck's head becomes its player.
    LaunchedEffect(current) { if (current) Player.current = playback else playback.pause() }
    DisposableEffect(playback) { onDispose { playback.pause(); if (Player.current === playback) Player.current = null } }
    LaunchedEffect(page.id) {
        val given = reading.playalongs?.get(page.tune.settingId)
        when {
            given != null || reading.playalongs != null -> playback.playalongs = given.orEmpty()
            // Your own tunes come with their play-alongs and your sound; a tune from The Session plays its notes.
            !page.tune.id.startsWith("session-") -> runCatching { Services.api.tune(page.tune.id) }.onSuccess {
                playback.playalongs = it.playalongs
                playback.heard = it.heard
                if (playback.track == null && reading.defaultSound == null) playback.changeSound(it.defaultSound)
            }
        }
        // A tunebook's page comes with its play-alongs; where you heard it still comes from the tune.
        if (reading.playalongs != null && !page.tune.id.startsWith("session-")) runCatching { Services.api.tune(page.tune.id) }.onSuccess { playback.heard = it.heard }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = bottomPadding + 24.dp)) {
        page.set?.let { set ->
            Row(Modifier.padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                RepeatMark(); Spacer(Modifier.width(8.dp))
                Text(set, style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tune.displayTitle, fontFamily = FontFamily.Serif, fontSize = 34.sp, lineHeight = 38.sp, letterSpacing = (-0.8).sp, modifier = Modifier.weight(1f, fill = false))
            if (tune.oftenPlayed == true) { Spacer(Modifier.width(8.dp)); OftenPlayedStar() }
        }
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val meta = tune.meta()
            Text(meta, style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current(), modifier = Modifier.weight(1f))
            if (editable) ProgressMenu(tune) { playback.tune = it }
            else if (tune.practice.level != Level.Unlearned) Standing(tune.practice.level)
        }
        if (tune.abc.isNotEmpty()) AbcView(Abc.forScore(tune.title, tune.kind, tune.meter, tune.mode, tune.abc), AbcStyle.Score, Modifier.padding(top = 20.dp), playback)
        page.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), modifier = Modifier.padding(top = 12.dp)) }
    }
}

@Composable
private fun Standing(level: Level, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        AbilityMark(level); Spacer(Modifier.width(6.dp))
        Text(level.label, style = MaterialTheme.typography.bodyMedium, color = Palette.mutedForeground.current())
    }
}

/** Where the tune stands for you: the five stages, or judged from your recorded speed. */
@Composable
internal fun ProgressMenu(tune: SavedTune, onChange: (SavedTune) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    fun save(level: Level?) {
        open = false
        scope.launch {
            saving = true
            runCatching { Services.api.setLevel(tune.id, level) }.onSuccess { practice ->
                val changed = tune.copy(practice = practice)
                onChange(changed); Library.update(changed)
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            }
            saving = false
        }
    }
    Box {
        Standing(tune.practice.level, Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = !saving) { open = true }.padding(8.dp).alpha(if (saving) 0.5f else 1f))
        DropdownMenu(open, { open = false }) {
            listOf(Level.Mastered, Level.Learned, Level.Learning, Level.Wanted, Level.Unlearned).forEach { level ->
                DropdownMenuItem({ Text(level.label, fontWeight = if (tune.practice.levelOverride == level) FontWeight.SemiBold else FontWeight.Normal) },
                    { save(level) }, leadingIcon = { AbilityMark(level) })
            }
            if (tune.practice.playableTempo != null) {
                DropdownMenuItem({ Text("From my best speed", fontWeight = if (tune.practice.levelOverride == null) FontWeight.SemiBold else FontWeight.Normal) }, { save(null) })
            }
        }
    }
}

/** Type part of a tune's name to find it in this list. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReaderSearch(pages: List<ReaderPage>, onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val matches = pages.indices.filter { query.isBlank() || pages[it].tune.matches(query) }
    ModalBottomSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            TextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Find a tune") }, singleLine = true, shape = RoundedCornerShape(14.dp),
                colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                    focusedContainerColor = Palette.muted.current(), unfocusedContainerColor = Palette.muted.current()))
            if (matches.isEmpty()) Text("No tune called that in this list.", color = Palette.text3.current(), modifier = Modifier.padding(vertical = 24.dp))
            LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
                items(matches, key = { pages[it].id }) { index ->
                    Column(Modifier.fillMaxWidth().clickable { onPick(index); onDismiss() }.padding(vertical = 10.dp)) {
                        Text(pages[index].tune.displayTitle, style = TuneType.trayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(pages[index].tune.meta(), style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
                    }
                }
            }
        }
    }
}

/** A tune often played at this tunebook's session. */
@Composable
fun OftenPlayedStar(size: Dp = 16.dp) {
    Icon(painterResource(R.drawable.ic_star), "Often played", Modifier.size(size), tint = Palette.brandDot.current())
}

/** The two dots and bars of a repeat sign: the mark of a set. */
@Composable
fun RepeatMark() {
    val dot = Palette.brandDot.current()
    val ink = Palette.brandInk.current()
    Canvas(Modifier.size(11.dp, 14.dp)) {
        val u = size.height / 14f
        drawCircle(dot, 1.5f * u, Offset(1.5f * u, 5f * u))
        drawCircle(dot, 1.5f * u, Offset(1.5f * u, 9f * u))
        drawRoundRect(ink, Offset(4.5f * u, 0f), Size(1.5f * u, 14f * u), CornerRadius(0.5f * u))
        drawRoundRect(ink, Offset(7.5f * u, 0f), Size(3f * u, 14f * u), CornerRadius(0.5f * u))
    }
}
