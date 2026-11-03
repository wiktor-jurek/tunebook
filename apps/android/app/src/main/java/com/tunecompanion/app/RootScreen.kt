package com.tunecompanion.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.text.format.DateFormat
import com.tunecompanion.app.api.FinderTune
import java.util.Date
import com.tunecompanion.app.designsystem.Motion
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.Radius
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import com.tunecompanion.app.listen.ListenEngine

/** Two tabs, one job each, with the listen tray docked above the tab bar on every screen. */
@Composable
fun RootScreen(onListen: (Mode) -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val state by ListenController.state.collectAsStateWithLifecycle()
    Scaffold(
        bottomBar = {
            Column {
                ListenTray(state, onListen)
                // Selection is brand-ink (settled); brand-dot orange is kept for what is live.
                val colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.primary)
                NavigationBar {
                    NavigationBarItem(tab == 0, { tab = 0 }, { Icon(painterResource(R.drawable.ic_tunes), null) }, label = { Text("Tunes") }, colors = colors)
                    NavigationBarItem(tab == 1, { tab = 1 }, { Icon(painterResource(R.drawable.ic_waveform), null) }, label = { Text("Recordings") }, colors = colors)
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding)) { if (tab == 0) TunesScreen() else RecordingsScreen() }
    }
}

/** The mic. Tap to name a tune; hold for a whole session. Once a tune is named it stays here; tap it for tonight's list. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ListenTray(state: ListenState, onListen: (Mode) -> Unit) {
    var showingHeard by rememberSaveable { mutableStateOf(false) }
    val level by ListenController.level.collectAsStateWithLifecycle()
    val shown = state.current.takeIf { !state.live || state.phase == Phase.Named }
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceContainer,
        shadowElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .combinedClickable(
                onClick = { if (!state.live) { if (state.current != null) showingHeard = true else onListen(Mode.NameTune) } },
                onLongClick = { if (!state.live) onListen(Mode.RecordSession) },
            ),
    ) { Column {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val icon = when {
                shown != null -> R.drawable.ic_music_note
                state.live -> R.drawable.ic_waveform
                else -> R.drawable.ic_mic
            }
            val scale = if (state.live && shown == null) 1f + (level * 4f).coerceAtMost(0.25f) else 1f
            Icon(painterResource(icon), null, Modifier.size(24.dp).graphicsLayer { scaleX = scale; scaleY = scale },
                tint = if (state.live || shown != null) Palette.brandDot.current() else MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.width(12.dp))
            AnimatedContent(
                targetState = Triple(headline(state, shown), detail(state, shown), shown != null),
                transitionSpec = { fadeIn(tween(Motion.DURATION_MS, easing = Motion.ease)) togetherWith fadeOut(tween(Motion.DURATION_MS, easing = Motion.ease)) },
                modifier = Modifier.weight(1f),
                label = "tray",
            ) { (headline, detail, isTune) ->
                Column {
                    Text(headline, style = if (isTune) TuneType.trayTitle else MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), maxLines = 1)
                }
            }
            when {
                state.live -> IconButton(onClick = ListenController::stop) { Icon(painterResource(R.drawable.ic_stop), "Stop") }
                state.current != null -> IconButton(onClick = { onListen(Mode.NameTune) }) { Icon(painterResource(R.drawable.ic_mic), "Listen again") }
            }
        }
        if (state.live && shown == null && state.downloading == null) {
            LinearProgressIndicator(progress = { state.confidence }, Modifier.fillMaxWidth(), color = Palette.brandDot.current(), trackColor = MaterialTheme.colorScheme.surfaceContainer)
        } else if (state.downloading != null) {
            LinearProgressIndicator(progress = { state.downloading }, Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.primary, trackColor = MaterialTheme.colorScheme.surfaceContainer)
        }
    } }
    if (showingHeard) HeardSheet(state, onDismiss = { showingHeard = false })
}

private fun headline(state: ListenState, shown: FinderTune?): String = when {
    state.problem != null && !state.live -> state.problem
    shown != null -> shown.displayTitle
    !state.live -> "Name a tune"
    state.downloading != null -> "Getting the tune finder, ${(state.downloading * 100).toInt()}%"
    state.phase == Phase.Narrowing -> "Narrowing it down"
    state.quiet -> "Waiting for music"
    else -> "Listening"
}

private fun detail(state: ListenState, shown: FinderTune?): String? = when {
    state.problem != null && !state.live -> null
    shown != null -> shown.meta
    state.live && state.mode == Mode.RecordSession -> if (state.heard.isEmpty()) "Recording the session" else "${state.heard.size} heard so far"
    else -> null
}

/** Tonight's tunes, newest first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeardSheet(state: ListenState, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val time = remember { DateFormat.getTimeFormat(context) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)) {
            Text("Heard tonight", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
            if (state.heard.isEmpty()) Text("Nothing heard yet", color = Palette.text3.current())
            state.heard.forEach { heard ->
                Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                    Text(heard.tune.displayTitle, style = TuneType.title)
                    Text("${heard.tune.meta}, ${time.format(Date(heard.at))}", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                if (state.heard.isNotEmpty()) TextButton(onClick = { ListenController.clearHeard(); onDismiss() }) { Text("Clear", color = MaterialTheme.colorScheme.error) }
                if (state.current != null) TextButton(onClick = { state.heard.firstOrNull()?.let { ListenController.reject(it) }; onDismiss() }) { Text("Not this tune") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TunesScreen() {
    val groups = listOf(
        "Learning" to listOf("The Silver Spear" to "Reel, D major", "The Kesh" to "Jig, G major"),
        "Can play along" to listOf("The Earl's Chair" to "Reel, D major", "Out on the Ocean" to "Jig, G major"),
    )
    Column {
        LargeTopAppBar(title = { Text("Tunes") })
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            groups.forEach { (group, tunes) ->
                item { Text(group, style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp)) }
                tunes.forEach { (title, meta) ->
                    item {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                            Text(title, style = TuneType.title)
                            Text(meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
                        }
                        HorizontalDivider(Modifier.padding(start = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
            item { Text("Listen engine ${ListenEngine.version}", style = MaterialTheme.typography.labelSmall, color = Palette.text4.current(), modifier = Modifier.padding(20.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordingsScreen() {
    Column {
        LargeTopAppBar(title = { Text("Recordings") })
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(painterResource(R.drawable.ic_waveform), null, Modifier.size(40.dp), tint = Palette.text3.current())
                Spacer(Modifier.size(12.dp))
                Text("No recordings yet", style = MaterialTheme.typography.titleMedium)
                Text("Record a session and its tunes become a setlist to practise at home.", style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current())
            }
        }
    }
}
