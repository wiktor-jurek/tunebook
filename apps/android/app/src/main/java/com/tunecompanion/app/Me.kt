// Me: your passport as a player, from /api/app/me, as Flighty's passport or Polarsteps' profile would have it. A
// cover that says who you are ("A reel person who goes off the beaten track"), the Standards (the 100 tunes every
// session knows as a scratch map of dots, filled with what you can play), the stamps you've collected, your sound,
// standards or rarities, the tunes you love and your sessions. Account settings sit behind the cover's gear.
package com.tunecompanion.app

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.api.Level
import com.tunecompanion.app.api.Passport
import com.tunecompanion.app.api.displayTitle
import com.tunecompanion.app.api.keyName
import com.tunecompanion.app.designsystem.Appearance
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun MeLayer(bottomPadding: Dp, onRead: (Reading) -> Unit, onSession: (Passport.BiggestNight) -> Unit) {
    val library by Library.state.collectAsStateWithLifecycle()
    var passport by remember { mutableStateOf<Passport?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf(false) }
    var signingIn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        runCatching { Services.api.passport() }
            .onSuccess { passport = it; problem = null }
            .onFailure { if (passport == null) problem = it.message ?: "Couldn't load your passport." }
    }
    // Reloads when you sign in, and when your tunes change (a level set, a tune kept).
    LaunchedEffect(library.user, library.tunes) { if (library.user != null) load() }

    if (library.phase == LibraryState.Phase.SignedOut) {
        if (signingIn) return SignIn(bottomPadding)
        return GhostPassport(bottomPadding) { signingIn = true }
    }
    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = bottomPadding + 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item("top") { Spacer(Modifier.statusBarsPadding().height(8.dp)) }
            val me = passport
            when {
                me == null && problem != null -> item("problem") {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(problem!!, color = Palette.text3.current(), textAlign = TextAlign.Center)
                        TextButton({ scope.launch { load() } }) { Text("Try again") }
                    }
                }
                me == null -> item("loading") { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                else -> {
                    item("cover") { Cover(me) { account = true } }
                    item("standards") { StandardsCard(me.standards, onRead) }
                    if (me.stamps.isNotEmpty()) item("stamps") { StampsCard(me.stamps) }
                    if (me.types.isNotEmpty()) item("sound") { Sound(me) }
                    if (me.popularity.bands.any { it.tunes > 0 }) item("popularity") { Popularity(me) }
                    if (me.favourites.isNotEmpty()) item("favourites") { Favourites(me, onRead) }
                    item("sessions") { AtSessions(me, onSession) }
                }
            }
        }
    }
    if (account) passport?.let { AccountSheet(it) { account = false } }
}

/** A card on the passport's pages, with its small-caps heading. */
@Composable
private fun Page(title: String, content: @Composable () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), color = Palette.card.current(), shadowElevation = 1.dp) {
        Column(Modifier.padding(20.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 1.sp, fontWeight = FontWeight.SemiBold),
                color = Palette.text3.current(), modifier = Modifier.padding(bottom = 8.dp))
            content()
        }
    }
}

/** A line under a page's heading: its bold verdict, then what it means. */
@Composable
private fun Lede(bold: String?, rest: String) {
    Text(androidx.compose.ui.text.buildAnnotatedString {
        if (bold != null) { pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append("$bold "); pop() }
        append(rest)
    }, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(bottom = 14.dp))
}

/** The cover: who you are, said as a player, and your three numbers. */
@Composable
private fun Cover(me: Passport, onAccount: () -> Unit) {
    val ink = Palette.brandInk.current()
    val on = Palette.onBrandInk.current()
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(ink)) {
        // The faint rings of a passport's security print, from the top right corner.
        Canvas(Modifier.matchParentSize()) {
            var r = 14.dp.toPx()
            while (r < size.maxDimension * 1.6f) { drawCircle(on.copy(alpha = 0.06f), r, Offset(size.width * 1.1f, -size.height * 0.1f), style = Stroke(1.dp.toPx())); r += 9.dp.toPx() }
        }
        Column(Modifier.padding(22.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).background(Palette.brandDot.current(), CircleShape), contentAlignment = Alignment.Center) {
                    Text(me.user.name.take(1).uppercase(), color = Palette.onBrandDot.current(), fontWeight = FontWeight.Bold, fontSize = 19.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(me.user.name, color = on, style = MaterialTheme.typography.titleMedium)
                    me.user.memberSince?.let { since ->
                        Text("MEMBER SINCE ${monthYear(since).uppercase()}", color = on.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.sp))
                    }
                }
                IconButton(onAccount) { Icon(painterResource(R.drawable.ic_settings), "Account and settings", tint = on) }
            }
            Text(me.headline.ifEmpty { "Your passport starts with your first tune." }, color = on, fontFamily = FontFamily.Serif, fontSize = 32.sp, lineHeight = 37.sp,
                modifier = Modifier.padding(top = 20.dp, bottom = 20.dp))
            Row(Modifier.fillMaxWidth()) {
                val big = MaterialTheme.typography.headlineLarge.copy(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, color = on)
                val hours = me.sessions.minutes / 60f
                listOf("Tunes you can play", "Sessions", "Hours at sessions").forEachIndexed { i, label ->
                    Column(Modifier.weight(1f).padding(end = 10.dp)) {
                        when (i) {
                            0 -> CountUp(me.repertoire.playable, big)
                            1 -> CountUp(me.sessions.recordings, big)
                            // Under ten hours, to the tenth: a first short session still counts for something.
                            else -> if (hours < 10) Text("%.1f".format(hours), style = big) else CountUp(hours.toInt(), big)
                        }
                        Text(label, color = on.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

/** A number that counts up when it first shows. */
@Composable
private fun CountUp(value: Int, style: androidx.compose.ui.text.TextStyle) {
    val shown = remember { Animatable(0f) }
    LaunchedEffect(value) { shown.animateTo(value.toFloat(), tween(900, easing = FastOutSlowInEasing)) }
    Text("${shown.value.toInt()}", style = style)
}

private fun levelColour(level: Level?, colours: Map<Level, Color>): Color? = level?.let { colours[it] }

private val LEVEL_WORDS = mapOf(Level.Mastered to "You can lead it", Level.Learned to "You can play along", Level.Learning to "You're learning it",
    Level.Wanted to "On your list", Level.Unlearned to "Saved, not assessed")

/** The Standards: the 100 tunes every session knows, a scratch map of dots filled with where you stand. */
@Composable
private fun StandardsCard(standards: Passport.Standards, onRead: (Reading) -> Unit) = Page("The Standards") {
    val library by Library.state.collectAsStateWithLifecycle()
    var picked by remember { mutableStateOf<Passport.Standard?>(null) }
    Lede(null, "You can play ${standards.playable} of the ${standards.total} tunes every session knows" +
        (if (standards.learning > 0) ", and you're learning ${standards.learning} more." else "."))
    val colours = mapOf(Level.Mastered to Palette.brandInk.current(), Level.Learned to Palette.learned.current(),
        Level.Learning to Palette.brandDot.current(), Level.Wanted to Palette.brandDot.current())
    val empty = Palette.lineStrong.current()
    val savedRing = Palette.brandInk.current()
    val tunes = standards.tunes
    Canvas(Modifier.fillMaxWidth().widthIn(max = 420.dp).aspectRatio(1f).pointerInput(tunes) {
        detectTapGestures { at ->
            val cell = size.width / 10f
            val index = (at.y / cell).toInt() * 10 + (at.x / cell).toInt()
            tunes.getOrNull(index)?.let { picked = if (picked?.tuneId == it.tuneId) null else it }
        }
    }) {
        val cell = size.width / 10f
        val r = cell * 0.36f
        tunes.forEachIndexed { i, tune ->
            val c = Offset(cell * (i % 10) + cell / 2, cell * (i / 10) + cell / 2)
            val radius = if (picked?.tuneId == tune.tuneId) r * 1.3f else r
            val fill = levelColour(tune.level, colours)
            if (fill != null) drawCircle(fill, radius, c)
            else drawCircle(if (tune.level == Level.Unlearned) savedRing else empty, radius, c, style = Stroke(1.5.dp.toPx()))
        }
    }
    Column(Modifier.padding(top = 10.dp)) {
        val tune = picked
        if (tune == null) Text("Tap a dot to see the tune.", style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current())
        else Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(displayTitle(tune.title), style = TuneType.trayTitle)
                Text(listOfNotNull(tune.kind?.replaceFirstChar { it.uppercase() }, tune.level?.let { LEVEL_WORDS[it] } ?: "Not one of yours yet").joinToString(". "),
                    style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            }
            val index = library.tunes.indexOfFirst { it.id == tune.savedId }
            if (index >= 0) TextButton({ onRead(Reading(library.tunes.map { ReaderPage(it, null, it.id) }, index)) }) { Text("Score") }
        }
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf(Level.Mastered to "Can lead", Level.Learned to "Can play", Level.Learning to "Learning").forEach { (level, label) ->
                Box(Modifier.size(9.dp).background(colours.getValue(level), CircleShape)); Text(label, style = MaterialTheme.typography.labelSmall, color = Palette.text3.current())
            }
            Canvas(Modifier.size(9.dp)) { drawCircle(savedRing, size.minDimension / 2 - 0.6.dp.toPx(), style = Stroke(1.2.dp.toPx())) }
            Text("Saved", style = MaterialTheme.typography.labelSmall, color = Palette.text3.current())
        }
    }
}

/** Passport stamps: earned ones inked (and pressed in, the first time they're seen), the rest ghosted with how far to go. */
@Composable
private fun StampsCard(stamps: List<Passport.Stamp>) = Page("Stamps") {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("ui", Context.MODE_PRIVATE) }
    val fresh = remember(stamps) {
        val seen = prefs.getStringSet("seenStamps", emptySet()).orEmpty()
        val earned = stamps.filter { it.earned }.map { it.id }
        prefs.edit().putStringSet("seenStamps", seen + earned).apply()
        earned.filter { it !in seen }
    }
    val inks = listOf(Palette.danger.current(), Palette.brandDot.current(), Palette.brandInk.current())
    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 6.dp)) {
        itemsIndexed(stamps, key = { _, stamp -> stamp.id }) { i, stamp ->
            StampView(stamp, ink = inks[i % inks.size], tilt = listOf(-7f, 4f, -3f, 6f, -5f, 3f)[i % 6], landIn = fresh.indexOf(stamp.id))
        }
    }
}

@Composable
private fun StampView(stamp: Passport.Stamp, ink: Color, tilt: Float, landIn: Int) {
    val ghost = Palette.text4.current()
    val colour = if (stamp.earned) ink else ghost
    val press = remember { Animatable(if (landIn >= 0) 1.6f else 1f) }
    val alpha = remember { Animatable(if (landIn >= 0) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (landIn < 0) return@LaunchedEffect
        delay(300L + landIn * 140L)
        launch { alpha.animateTo(1f, tween(160)) }
        press.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
    }
    Column(Modifier.width(112.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(100.dp).graphicsLayer { scaleX = press.value; scaleY = press.value; this.alpha = alpha.value }.rotate(tilt), contentAlignment = Alignment.Center) {
            Canvas(Modifier.matchParentSize()) {
                val r = size.minDimension / 2 - 2.dp.toPx()
                if (stamp.earned) {
                    drawCircle(colour, r, style = Stroke(2.5.dp.toPx()))
                    drawCircle(colour, r - 5.dp.toPx(), style = Stroke(1.dp.toPx()))
                } else drawCircle(colour, r, style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(), 5.dp.toPx()))))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 14.dp)) {
                Text(stamp.title.uppercase(), color = colour, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 13.sp, letterSpacing = 0.6.sp, textAlign = TextAlign.Center)
                Text(stamp.at?.let { shortDate(it) } ?: stamp.progress?.let { "${it.have} of ${it.need}" } ?: "Not yet",
                    color = colour, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
            }
        }
        Text(stamp.line, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), textAlign = TextAlign.Center, maxLines = 3,
            modifier = Modifier.padding(top = 6.dp))
    }
}

/** Your sound: the type you play most, every type ranked, and your home key. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Sound(me: Passport) = Page("Your sound") {
    me.personas.type?.let { Lede("${it.title}.", it.line) }
    val most = me.types.maxOf { it.total }.coerceAtLeast(1)
    me.types.take(6).forEach { type ->
        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(type.kind.replaceFirstChar { it.uppercase() } + "s", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.width(96.dp))
            BoxWithConstraints(Modifier.weight(1f).height(10.dp).background(Palette.muted.current(), RoundedCornerShape(5.dp))) {
                Box(Modifier.fillMaxHeight().width(maxWidth * (type.total / most.toFloat())).background(Palette.brandDotSoft.current(), RoundedCornerShape(5.dp)))
                Box(Modifier.fillMaxHeight().width(maxWidth * (type.playable / most.toFloat())).background(Palette.brandDot.current(), RoundedCornerShape(5.dp)))
            }
            Text("${type.playable} of ${type.total}", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(), textAlign = TextAlign.End, modifier = Modifier.width(60.dp))
        }
    }
    if (me.keys.isNotEmpty()) FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        me.keys.forEachIndexed { i, key ->
            val home = i == 0
            Surface(shape = RoundedCornerShape(999.dp), color = if (home) Palette.brandInkSoft.current() else Palette.muted.current()) {
                Text(if (home) "Your home key: ${keyName(key.mode)}" else keyName(key.mode), style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (home) FontWeight.SemiBold else FontWeight.Normal, color = if (home) Palette.brandInk.current() else Palette.mutedForeground.current(),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            }
        }
    }
}

/** Standards or rarities: where your tunes sit among every tune on The Session. */
@Composable
private fun Popularity(me: Passport) = Page("Standards or rarities") {
    me.personas.popularity?.let { Lede("${it.title}.", it.line) }
    val most = me.popularity.bands.maxOf { it.tunes }.coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().height(100.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        me.popularity.bands.forEach { band ->
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Bottom, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${band.tunes}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                Box(Modifier.fillMaxWidth().height((72f * band.tunes / most).dp.coerceAtLeast(4.dp))
                    .background(if (band.band >= 4) Palette.brandDot.current() else Palette.brandInk.current(), RoundedCornerShape(8.dp)))
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
        me.popularity.bands.forEach { Text(it.label, style = MaterialTheme.typography.labelSmall, color = Palette.text3.current(), textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
    }
    me.popularity.rarest?.let { Text("Your rarest: ${displayTitle(it.title)}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp)) }
}

/** The tunes you love, side by side, each with its opening bars. */
@Composable
private fun Favourites(me: Passport, onRead: (Reading) -> Unit) = Page("Tunes you love") {
    val pages = me.favourites.map { ReaderPage(it.asSaved, null, "fav-${it.id}") }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(me.favourites, key = { _, tune -> tune.id }) { index, tune ->
            Column(Modifier.width(250.dp).clip(RoundedCornerShape(18.dp)).background(Palette.muted.current()).clickable { onRead(Reading(pages, index)) }.padding(14.dp)) {
                Text(listOfNotNull(tune.emoji, tune.asSaved.displayTitle).joinToString(" "), style = TuneType.trayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val why = listOfNotNull(
                    tune.starred.takeIf { it > 0 }?.let { "Often played in your tunebooks" },
                    tune.heard.takeIf { it > 0 }?.let { if (it == 1) "Heard once" else "Heard $it times" },
                ).joinToString(", ").ifEmpty { "You can lead it" }
                Text(why, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
                AbcView(Abc.openingPhrase(tune.title, tune.kind, tune.meter, tune.mode, tune.abc), AbcStyle.Phrase, Modifier.padding(top = 6.dp))
            }
        }
    }
}

/** At sessions: how often you go (the last twelve months), your biggest night, and the tune you hear most. */
@Composable
private fun AtSessions(me: Passport, onSession: (Passport.BiggestNight) -> Unit) = Page("At sessions") {
    val s = me.sessions
    if (s.recordings == 0) {
        Text("Record a session and it shows here: how often you go, your biggest nights, the tunes you hear most.", style = MaterialTheme.typography.bodyLarge)
        return@Page
    }
    Row(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        listOf("${s.recordings}" to "Sessions", "%.1f".format(s.minutes / 60f) to "Hours", "${s.tunesHeard}" to "Tunes heard").forEach { (n, label) ->
            Column(Modifier.weight(1f)) {
                Text(n, style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold))
                Text(label, style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            }
        }
    }
    if (s.byMonth.isNotEmpty()) MonthBars(s.byMonth)
    s.biggestNight?.let { night ->
        Row(Modifier.fillMaxWidth().padding(top = 14.dp).clip(RoundedCornerShape(12.dp)).clickable { onSession(night) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Biggest night", style = MaterialTheme.typography.labelMedium, color = Palette.text3.current())
                Text("${sessionName(night.recordedAt)}, ${night.tunes} tunes", style = TuneType.trayTitle)
            }
            Icon(painterResource(R.drawable.ic_chevron_right), null, tint = Palette.text3.current())
        }
    }
    s.mostHeard?.let {
        Text("Heard most: ${displayTitle(it.title)}, ${it.times} times", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
}

/** Sessions in each of the last twelve months. */
@Composable
private fun MonthBars(months: List<Passport.Month>) {
    val most = months.maxOf { it.sessions }.coerceAtLeast(1)
    val bar = Palette.danger.current()
    val none = Palette.muted.current()
    Column {
        Canvas(Modifier.fillMaxWidth().height(80.dp)) {
            val slot = size.width / months.size
            val w = minOf(slot * 0.6f, 22.dp.toPx())
            months.forEachIndexed { i, month ->
                val h = if (month.sessions == 0) 4.dp.toPx() else size.height * (0.12f + 0.88f * month.sessions / most)
                drawRoundRect(if (month.sessions == 0) none else bar, Offset(slot * i + (slot - w) / 2, size.height - h), Size(w, h), CornerRadius(5.dp.toPx()))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            months.forEach { month ->
                Text(java.time.YearMonth.parse(month.month).month.getDisplayName(java.time.format.TextStyle.NARROW, Locale.ENGLISH),
                    style = MaterialTheme.typography.labelSmall, color = Palette.text3.current(), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            }
        }
    }
}

/** Signed out: an empty passport, waiting for its first stamp. */
@Composable
private fun GhostPassport(bottomPadding: Dp, onSignIn: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = bottomPadding + 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Spacer(Modifier.statusBarsPadding().height(8.dp)) }
        item {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Palette.brandInk.current()).padding(22.dp)) {
                val on = Palette.onBrandInk.current()
                Text("YOUR PASSPORT", color = on.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.sp))
                Text("What kind of player are you?", color = on, fontFamily = FontFamily.Serif, fontSize = 32.sp, lineHeight = 37.sp, modifier = Modifier.padding(vertical = 14.dp))
                Text("Sign in and every tune you learn and every session you record fills it in: the standards you know, the stamps you collect, the tunes you love.",
                    color = on.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium)
                Button(onSignIn, Modifier.padding(top = 18.dp), colors = ButtonDefaults.buttonColors(containerColor = Palette.brandDot.current(), contentColor = Palette.onBrandDot.current())) {
                    Text("Sign in to start your passport")
                }
            }
        }
        item {
            StampsCard(listOf(
                Passport.Stamp("first-tune", "First tune", "Save your first tune.", false),
                Passport.Stamp("first-session", "First session", "Record your first session.", false),
                Passport.Stamp("play-10", "Ten to play", "10 tunes you can play along with.", false),
            ))
        }
    }
}

/** Account and settings, behind the cover's gear: who is signed in, light or dark, and signing out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSheet(me: Passport, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(me.user.name, style = MaterialTheme.typography.titleLarge)
            Text(me.user.email, style = MaterialTheme.typography.bodyMedium, color = Palette.text3.current())
            Text("${me.repertoire.tunes} tunes saved, in ${me.repertoire.tunebooks} ${if (me.repertoire.tunebooks == 1) "tunebook" else "tunebooks"}",
                style = MaterialTheme.typography.bodySmall, color = Palette.text3.current())
            if (Services.api.base != "https://tunecompanion.com") Text("Connected to ${Services.api.base}", style = MaterialTheme.typography.labelSmall, color = Palette.text4.current())
            Text("Appearance", style = MaterialTheme.typography.labelLarge, color = Palette.text3.current(), modifier = Modifier.padding(top = 18.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                Appearance.entries.forEachIndexed { i, appearance ->
                    SegmentedButton(Appearance.chosen == appearance, { Appearance.choose(appearance) },
                        SegmentedButtonDefaults.itemShape(i, Appearance.entries.size)) { Text(appearance.label) }
                }
            }
            TextButton({ scope.launch { onDismiss(); Library.signOut() } }, Modifier.padding(top = 8.dp)) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
            Text("Listen engine ${com.tunecompanion.app.listen.ListenEngine.version}", style = MaterialTheme.typography.labelSmall, color = Palette.text4.current())
        }
    }
}

/** "March 2026". */
private fun monthYear(iso: String) = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH))
}.getOrDefault("")

/** "3 Nov 2026". */
private fun shortDate(iso: String) = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH))
}.getOrDefault("")
