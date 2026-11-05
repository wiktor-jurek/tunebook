// The deck while a score is open behind it. It is about the score, not the microphone: its head is the score's player,
// half up is practice (tempo, count-in, the sound or a play-along, where you stand with the tune), and full is the
// tune's world (your tunebooks with it, the moments you heard it in your recordings, The Session). Its colour is brand
// ink, so green and red keep meaning listening; the mic in the head is the way back to naming a tune.
package com.tunecompanion.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.TuneHeard
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlin.math.roundToInt

/** Half up: how you practise this tune. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PracticePanel(playback: ScorePlayback) {
    val ink = Palette.brandInk.current()
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        // Tempo, as a slider from half speed to a little faster than written.
        Column {
            var speed by remember(playback) { mutableFloatStateOf(playback.speed.toFloat()) }
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Tempo", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.weight(1f))
                Text("${speed.roundToInt()}%, ${playback.bpm} BPM", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
            }
            Slider(speed, { speed = it }, valueRange = 50f..120f, steps = 13, onValueChangeFinished = { playback.changeSpeed(speed.roundToInt()) },
                colors = SliderDefaults.colors(thumbColor = ink, activeTrackColor = ink))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (value in listOf(60, 75, 85, 100)) PracticeChip("$value%", playback.speed == value) { speed = value.toFloat(); playback.changeSpeed(value) }
            }
        }
        // What plays: the score's notes in a sound, or a recording of the tune to play along with.
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Sound", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (sound in ScoreSound.entries) PracticeChip(sound.label.substringBefore(","), playback.track == null && playback.program == sound.program) { playback.changeSound(sound.program) }
            }
            if (playback.playalongs.isNotEmpty()) {
                Text("Play along with", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(top = 6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (track in playback.playalongs) PracticeChip(track.label + if (track.otherSetting) ", other setting" else "", playback.track?.id == track.id) { playback.changeTrack(track) }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Count-in", style = MaterialTheme.typography.bodyLarge)
                Text("A bar of clicks before the tune starts", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            }
            Switch(playback.countIn, { playback.changeCountIn(it) }, colors = SwitchDefaults.colors(checkedTrackColor = ink))
        }
        // Where you stand with it: set here, or keep a tune you don't have yet.
        val tune = playback.tune
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("You", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            when {
                tune != null && playback.editable -> ProgressMenu(tune) { playback.tune = it }
                tune != null && tune.practice.level != Level.Unlearned -> Text(tune.practice.level.label, color = Palette.mutedForeground.current())
                tune != null && Services.api.signedIn -> {
                    val listen by ListenController.state.collectAsStateWithLifecycle()
                    OutlinedButton({ ListenController.learnLater(FinderTune(tune.tuneId, tune.settingId, tune.title, tune.kind, tune.meter, tune.mode, tune.abc)) },
                        enabled = listen.saving != tune.tuneId) { Text(if (listen.saving == tune.tuneId) "Saving" else "Learn later") }
                }
            }
        }
    }
}

/** Full: the tune's world. */
@Composable
fun TuneWorld(playback: ScorePlayback, onHeard: (TuneHeard) -> Unit) {
    val library by Library.state.collectAsStateWithLifecycle()
    val tune = playback.tune
    val books = library.books.filter { book -> tune != null && book.tuneIds?.contains(tune.id) == true }
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Text("In your tunebooks", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(top = 8.dp))
        if (books.isEmpty()) Text("Not in any of your tunebooks yet.", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        books.forEach { book -> Text(listOfNotNull(book.emoji, book.name).joinToString(" "), style = TuneType.trayTitle) }

        Text("Heard at your sessions", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(top = 12.dp))
        if (playback.heard.isEmpty()) Text("Not named at any of your sessions yet.", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        playback.heard.forEach { heard ->
            Row(Modifier.fillMaxWidth().clickable { onHeard(heard) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_play), null, Modifier.size(16.dp), tint = Palette.brandInk.current())
                Spacer(Modifier.width(10.dp))
                Text(heard.title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Text("at ${clock(heard.startMs)}", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = Palette.text3.current())
            }
        }

        if (tune != null) OutlinedButton({ context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://thesession.org/tunes/${tune.tuneId}"))) },
            Modifier.padding(top = 12.dp)) { Text("Other settings on The Session") }
    }
}

@Composable
private fun PracticeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val ink = Palette.brandInk.current()
    FilterChip(selected, onClick, { Text(label, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal) }, shape = RoundedCornerShape(999.dp),
        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Palette.brandInkSoft.current(), selectedLabelColor = ink),
        border = FilterChipDefaults.filterChipBorder(true, selected, borderColor = MaterialTheme.colorScheme.outlineVariant, selectedBorderColor = ink.copy(alpha = 0.4f)))
}
