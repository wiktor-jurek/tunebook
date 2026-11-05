// The music layer while a session records: tonight's setlist building up behind the deck, the tune
// playing now large at the top with its opening bars, the ones before it below. Tap any for its score.
package com.tunecompanion.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tunecompanion.app.api.FinderTune
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current
import java.text.DateFormat
import java.util.Date

@Composable
fun TonightLayer(listen: ListenState, bottomPadding: Dp, onOpen: (FinderTune) -> Unit) {
    val time = remember { DateFormat.getTimeInstance(DateFormat.SHORT) }
    val tonight = listen.tonight
    val colours = tuneColours(tonight)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = bottomPadding + 16.dp)) {
        item("title") {
            Column(Modifier.statusBarsPadding().padding(top = 20.dp, bottom = 12.dp)) {
                Text("Tonight", style = MaterialTheme.typography.displaySmall)
                Text(if (tonight.isEmpty()) "Each tune joins the setlist as it is named." else "${tonight.size} ${if (tonight.size == 1) "tune" else "tunes"} so far",
                    style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current())
            }
        }
        itemsIndexed(tonight, key = { _, heard -> "${heard.tune.tuneId}-${heard.at}" }) { index, heard ->
            val now = index == 0
            // A stripe in the tune's colour, as its bars are in the deck's waveform.
            val stripe = colours(heard.tune.tuneId)
            Column(Modifier.fillMaxWidth().clickable { onOpen(heard.tune) }.padding(vertical = if (now) 16.dp else 10.dp).animateItem()
                .drawBehind { drawRoundRect(stripe, size = Size(4.dp.toPx(), size.height), cornerRadius = CornerRadius(2.dp.toPx())) }
                .padding(start = 18.dp)) {
                if (now) Text("Now playing", style = MaterialTheme.typography.labelLarge, color = colours(heard.tune.tuneId))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(heard.tune.displayTitle, fontFamily = FontFamily.Serif, fontSize = if (now) 34.sp else 24.sp, lineHeight = if (now) 38.sp else 28.sp,
                        modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(10.dp))
                    Text(time.format(Date(heard.at)), style = MaterialTheme.typography.bodySmall, color = Palette.text4.current(), modifier = Modifier.padding(bottom = 4.dp))
                }
                Text(heard.tune.meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
                if (now) heard.tune.abc?.let {
                    AbcView(Abc.openingPhrase(heard.tune.title, heard.tune.kind, heard.tune.meter, heard.tune.mode, it), AbcStyle.Phrase, Modifier.padding(top = 10.dp))
                }
            }
        }
    }
}
