// A tunebook, as the phone's web book page and the iPhone's BookView: its tunes and sets in playing
// order, each opening the reader at its score. Stars mark tunes often played at the book's session;
// one tap shows only those. Progress is set in the reader only in your own books.
package com.tunecompanion.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tunecompanion.app.api.BookDetail
import com.tunecompanion.app.api.BookSummary
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.launch

@Composable
fun BookScreen(summary: BookSummary, bottomPadding: Dp, onBack: () -> Unit, onRead: (Reading) -> Unit) {
    BackHandler(onBack = onBack)
    var detail by remember(summary.id) { mutableStateOf<BookDetail?>(null) }
    var problem by remember(summary.id) { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var query by rememberSaveable(summary.id) { mutableStateOf("") }
    var oftenPlayed by rememberSaveable(summary.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        runCatching { Services.api.book(summary.id) }
            .onSuccess { detail = it; problem = null }
            .onFailure { if (detail == null) problem = it.message ?: "Could not load the tunebook." }
    }
    LaunchedEffect(summary.id) { load() }

    val book = detail
    val pages = book?.sections.orEmpty().flatMap { section -> section.members.map { ReaderPage(it, section.set, "${section.entryId}-${it.id}") } }
    val hasStars = pages.any { it.tune.oftenPlayed == true }
    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottomPadding + 16.dp)) {
            item("title") {
                Column(Modifier.statusBarsPadding().padding(top = 8.dp)) {
                    Row(Modifier.padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onBack) { Icon(painterResource(R.drawable.ic_arrow_back), "Back") }
                        Spacer(Modifier.weight(1f))
                        if (hasStars) IconToggleButton(oftenPlayed, { oftenPlayed = it }) {
                            Icon(painterResource(if (oftenPlayed) R.drawable.ic_star else R.drawable.ic_star_outline),
                                if (oftenPlayed) "Show every tune" else "Show only tunes often played",
                                tint = if (oftenPlayed) Palette.brandDot.current() else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text(listOfNotNull(book?.book?.emoji ?: summary.emoji, book?.book?.name ?: summary.name).joinToString(" "),
                        style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(horizontal = 20.dp))
                }
            }
            when {
                book == null && problem != null -> item("problem") {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Couldn't open the tunebook", style = MaterialTheme.typography.titleMedium)
                        Text(problem!!, color = Palette.text3.current(), textAlign = TextAlign.Center)
                        TextButton({ scope.launch { load() } }) { Text("Try again") }
                    }
                }
                book == null -> item("loading") { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                pages.isEmpty() -> item("empty") { Text("No tunes in this book yet.", color = Palette.text3.current(), modifier = Modifier.padding(20.dp)) }
                else -> {
                    item("search") {
                        TextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), placeholder = { Text("Search this tunebook") },
                            singleLine = true, shape = RoundedCornerShape(14.dp),
                            colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                                focusedContainerColor = Palette.muted.current(), unfocusedContainerColor = Palette.muted.current()))
                    }
                    val shown = pages.withIndex().filter { (_, page) -> (!oftenPlayed || page.tune.oftenPlayed == true) && (query.isBlank() || page.tune.matches(query)) }
                    if (shown.isEmpty()) item("none") {
                        Text(if (oftenPlayed) "No tune here is marked often played." else "No tune called that.", color = Palette.text3.current(), modifier = Modifier.padding(20.dp))
                    }
                    // A set's tunes sit together under its name; single tunes stand alone.
                    book.sections.forEach { section ->
                        val rows = shown.filter { it.value.id.startsWith("${section.entryId}-") }
                        if (rows.isEmpty()) return@forEach
                        section.set?.let { set ->
                            item("set-${section.entryId}") {
                                Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                    RepeatMark(); Spacer(Modifier.width(8.dp))
                                    Text(set, style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
                                }
                            }
                        }
                        items(rows, key = { it.value.id }) { (index, page) ->
                            BookRow(page) { onRead(Reading(pages, index, editable = book.book.isOwner,
                                playalongs = book.playalongs.mapNotNull { (id, tracks) -> id.toIntOrNull()?.let { it to tracks } }.toMap(), defaultSound = book.defaultSound)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BookRow(page: ReaderPage, onClick: () -> Unit) {
    val tune = page.tune
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        Text(tune.emoji ?: "🎵", fontSize = 22.sp, modifier = Modifier.width(36.dp).alpha(if (tune.emoji == null || tune.emoji == "🎵") 0.35f else 1f))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(tune.displayTitle, style = TuneType.title, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (tune.oftenPlayed == true) { Spacer(Modifier.width(6.dp)); OftenPlayedStar(14.dp) }
            }
            val meta = tune.meta()
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        }
        Spacer(Modifier.width(8.dp))
        AbilityMark(tune.practice.level)
    }
}
