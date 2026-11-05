// The reading and learning layer, behind the listening drawer: your tunes (grouped as you choose, as
// the web and the iPhone app do), your recordings, and scores full screen. Signed out, it asks you to
// sign in; the drawer in front still names tunes.
package com.tunecompanion.app

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.BookSummary
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.RecordingSummary
import com.tunecompanion.app.api.SavedTune
import com.tunecompanion.app.api.displayTitle
import com.tunecompanion.app.api.keyName
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.launch

// MARK: Tunes

enum class GroupBy(val label: String, val short: String) {
    Stage("Stage of learning", "Stage"), Key("Key", "Key"), Type("Type", "Type"), Book("Tunebook", "Tunebook"), None("No grouping", "Ungrouped")
}

data class TuneGroup(val key: String, val label: String, val tunes: List<SavedTune>, val book: BookSummary? = null)

/** As the web's groupTunes: fixed group order, tunes keep their order; by tunebook a tune is in every book it is in. */
fun groupTunes(tunes: List<SavedTune>, by: GroupBy, books: List<BookSummary>): List<TuneGroup> = when (by) {
    GroupBy.None -> if (tunes.isEmpty()) emptyList() else listOf(TuneGroup("all", "", tunes))
    GroupBy.Book -> {
        val inBooks = books.flatMap { it.tuneIds.orEmpty() }.toSet()
        (books.map { book -> TuneGroup(book.id, book.name, tunes.filter { it.id in book.tuneIds.orEmpty() }, book) } +
            TuneGroup("none", "Not in a tunebook", tunes.filter { it.id !in inBooks })).filter { it.tunes.isNotEmpty() }
    }
    else -> {
        val stages = listOf(Level.Mastered, Level.Learned, Level.Learning, Level.Wanted, Level.Unlearned)
        tunes.groupBy { tune ->
            when (by) {
                GroupBy.Stage -> tune.practice.level.name to tune.practice.level.label
                GroupBy.Key -> (tune.mode ?: "") to (tune.mode?.let(::keyName) ?: "No key")
                else -> (tune.kind?.lowercase() ?: "") to (tune.kind?.replaceFirstChar { it.uppercase() } ?: "Other")
            }
        }.entries.sortedBy { (key, _) ->
            if (by == GroupBy.Stage) stages.indexOfFirst { it.name == key.first }.toString() else if (key.first.isEmpty()) "1" else "0${key.second}"
        }.map { (key, members) -> TuneGroup(key.first, key.second, members) }
    }
}

@Composable
fun TunesLayer(bottomPadding: Dp, onRead: (Reading) -> Unit) {
    val library by Library.state.collectAsStateWithLifecycle()
    var book by remember { mutableStateOf<BookSummary?>(null) }
    when (library.phase) {
        LibraryState.Phase.SignedOut -> SignIn(bottomPadding)
        LibraryState.Phase.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        LibraryState.Phase.Failed -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(library.problem ?: "Could not load your tunes.", textAlign = TextAlign.Center)
            TextButton({ Library.load() }) { Text("Try again") }
        }
        LibraryState.Phase.Ready -> book?.let { BookScreen(it, bottomPadding, onBack = { book = null }, onRead = onRead) }
            ?: TuneList(library, bottomPadding, onRead, onBook = { book = it })
    }
}

@Composable
private fun TuneList(library: LibraryState, bottomPadding: Dp, onRead: (Reading) -> Unit, onBook: (BookSummary) -> Unit) {
    val prefs = LocalContext.current.getSharedPreferences("ui", 0)
    var groupBy by remember { mutableStateOf(runCatching { GroupBy.valueOf(prefs.getString("groupBy", "Stage")!!) }.getOrDefault(GroupBy.Stage)) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val shown = if (query.isBlank()) library.tunes else library.tunes.filter { it.matches(query) }
    val groups = groupTunes(shown, groupBy, library.books)
    // The reader turns through the tunes as they are listed, group after group.
    val pages = groups.flatMap { group -> group.tunes.map { ReaderPage(it, null, "${group.key}-${it.id}") } }
    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; Library.refresh(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottomPadding + 16.dp)) {
            item("title") {
                Row(Modifier.statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Tunes", style = MaterialTheme.typography.displaySmall, modifier = Modifier.weight(1f))
                    GroupMenu(groupBy) { groupBy = it; prefs.edit().putString("groupBy", it.name).apply() }
                }
            }
            item("search") {
                TextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), placeholder = { Text("Search your tunes") },
                    singleLine = true, shape = RoundedCornerShape(14.dp),
                    colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                        focusedContainerColor = Palette.muted.current(), unfocusedContainerColor = Palette.muted.current()))
            }
            if (library.tunes.isEmpty()) item("empty") {
                Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    BrandMark(Modifier.size(48.dp))
                    Text("Save tunes at home, or name one that's playing with the microphone below, and they appear here.", textAlign = TextAlign.Center,
                        color = Palette.text3.current(), modifier = Modifier.padding(top = 12.dp))
                }
            }
            groups.forEach { group ->
                if (group.label.isNotEmpty()) item("h-${group.key}") {
                    // Grouped by tunebook, each book's heading opens it.
                    val book = group.book
                    Row(Modifier.fillMaxWidth().then(if (book != null) Modifier.clickable { onBook(book) } else Modifier)
                        .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(listOfNotNull(group.book?.emoji, group.label).joinToString(" "), style = MaterialTheme.typography.labelLarge, color = Palette.text3.current())
                        if (book != null) Icon(painterResource(R.drawable.ic_chevron_right), "Open", Modifier.size(16.dp), tint = Palette.text3.current())
                        Spacer(Modifier.weight(1f))
                        Text("${group.tunes.size}", style = MaterialTheme.typography.labelLarge, color = Palette.text4.current())
                    }
                }
                items(group.tunes, key = { "${group.key}-${it.id}" }) { tune ->
                    TuneRow(tune, groupBy) { onRead(Reading(pages, pages.indexOfFirst { it.id == "${group.key}-${tune.id}" }.coerceAtLeast(0))) }
                }
            }
            if (groups.isEmpty() && query.isNotBlank()) item("none") {
                Text("No tune of yours matches \"$query\".", color = Palette.text3.current(), modifier = Modifier.padding(20.dp))
            }
            if (library.sharedBooks.isNotEmpty() && query.isBlank()) {
                item("shared") { Text("Shared with you", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 6.dp)) }
                items(library.sharedBooks, key = { "s-${it.id}" }) { book ->
                    Text("${book.emoji ?: "📖"}  ${book.name}", modifier = Modifier.fillMaxWidth().clickable { onBook(book) }.padding(horizontal = 20.dp, vertical = 12.dp))
                }
            }
        }
    }
}

internal fun SavedTune.matches(query: String): Boolean {
    val fold = { s: String -> java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase() }
    val text = fold(listOf(displayTitle, title, kind.orEmpty(), mode?.let(::keyName).orEmpty()).joinToString(" "))
    return fold(query).split(" ").filter { it.isNotBlank() }.all { it in text }
}

@Composable
private fun TuneRow(tune: SavedTune, groupBy: GroupBy, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        // The emoji a tune gets when nothing better matches its title shows faintly, so chosen ones stand out.
        Text(tune.emoji ?: "🎵", fontSize = 22.sp, modifier = Modifier.width(36.dp).alpha(if (tune.emoji == null || tune.emoji == "🎵") 0.35f else 1f))
        Column(Modifier.weight(1f)) {
            Text(tune.displayTitle, style = TuneType.title)
            val meta = tune.meta(withKind = groupBy != GroupBy.Type, withKey = groupBy != GroupBy.Key)
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
        }
        if (groupBy != GroupBy.Stage) AbilityMark(tune.practice.level)
    }
}

/** Four bars, filled one per step past Not assessed: Want to learn fills one, Can lead all four. */
@Composable
fun AbilityMark(level: Level) {
    val fill = when (level) {
        Level.Wanted, Level.Learning -> Palette.brandDot.current()
        Level.Learned -> Palette.learned.current()
        Level.Mastered -> Palette.brandInk.current()
        Level.Unlearned -> Palette.lineStrong.current()
    }
    val empty = Palette.accent.current()
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        listOf(4, 6, 9, 12).forEachIndexed { i, h -> Box(Modifier.size(3.dp, h.dp).background(if (i + 1 <= level.rank) fill else empty, RoundedCornerShape(1.dp))) }
    }
}

@Composable
private fun GroupMenu(groupBy: GroupBy, onChange: (GroupBy) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton({ open = true }) { Text(groupBy.short) }
        DropdownMenu(open, { open = false }) {
            GroupBy.entries.forEach { DropdownMenuItem({ Text(it.label) }, { onChange(it); open = false }) }
        }
    }
}

// MARK: Signing in

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
internal fun SignIn(bottomPadding: Dp) {
    var creating by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 28.dp).padding(top = 48.dp, bottom = bottomPadding + 24.dp)
        .animateContentSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandMark(Modifier.size(64.dp))
        Text("Your tunes, at the session", fontFamily = FontFamily.Serif, fontSize = 28.sp, textAlign = TextAlign.Center)
        Text("Sign in to see your tunes and tunebooks, and keep the tunes you hear. You can name tunes without an account.",
            textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        val context = LocalContext.current
        OutlinedButton({
            scope.launch {
                busy = true; problem = null
                try { Library.signInWithGoogle(GoogleSignIn.idToken(context)) }
                catch (_: GoogleSignIn.Cancelled) {}
                catch (cause: Exception) { problem = cause.message ?: "Something went wrong. Try again." }
                busy = false
            }
        }, Modifier.fillMaxWidth().height(48.dp), enabled = !busy) {
            Image(painterResource(R.drawable.ic_google), null, Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text("Continue with Google", color = MaterialTheme.colorScheme.onSurface)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
            Text("or with email", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), modifier = Modifier.padding(horizontal = 12.dp))
            HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(!creating, { creating = false; problem = null }, SegmentedButtonDefaults.itemShape(0, 2)) { Text("Sign in") }
            SegmentedButton(creating, { creating = true; problem = null }, SegmentedButtonDefaults.itemShape(1, 2)) { Text("Create account") }
        }
        if (creating) OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        when {
            problem != null -> Text(problem!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            sent -> Text("Check your email for a link to verify your address, then sign in here.", style = MaterialTheme.typography.bodySmall)
        }
        Button({
            scope.launch {
                busy = true; problem = null
                try {
                    if (creating) { Library.signUp(name, email, password); sent = true; creating = false } else Library.signIn(email, password)
                } catch (cause: Exception) { problem = cause.message ?: "Something went wrong. Try again." }
                busy = false
            }
        }, Modifier.fillMaxWidth().height(48.dp), enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!creating || name.isNotBlank())) {
            Text(if (creating) "Create account" else "Sign in")
        }
        if (!creating) TextButton({ uri.openUri("${Services.api.base}/forgot-password") }) { Text("Forgot your password?") }
    }
}

// MARK: Recordings

