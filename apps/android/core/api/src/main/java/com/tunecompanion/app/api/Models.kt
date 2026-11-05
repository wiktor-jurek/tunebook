// What the API answers, as the iPhone's API module decodes it.
package com.tunecompanion.app.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Level(val label: String, val rank: Int) {
    @SerialName("unlearned") Unlearned("Not assessed", 0),
    @SerialName("wanted") Wanted("Want to learn", 1),
    @SerialName("learning") Learning("Learning", 2),
    @SerialName("learned") Learned("Can play along", 3),
    @SerialName("mastered") Mastered("Can lead", 4);

    val known: Boolean get() = this == Learned || this == Mastered
}

@Serializable
data class Practice(val level: Level = Level.Unlearned, val playableTempo: Int? = null, val levelOverride: Level? = null)

@Serializable
data class SignedInUser(val id: String, val name: String, val email: String, val memberSince: String? = null)

/** One of your saved tunes. */
@Serializable
data class SavedTune(
    val id: String,
    val tuneId: Int,
    val settingId: Int,
    val title: String,
    val emoji: String? = null,
    val kind: String? = null,
    val meter: String? = null,
    val mode: String? = null,
    val abc: String,
    val practice: Practice = Practice(),
    val oftenPlayed: Boolean? = null,
) {
    val displayTitle: String get() = displayTitle(title)
    fun meta(withKind: Boolean = true, withKey: Boolean = true) = meta(kind.takeIf { withKind }, mode.takeIf { withKey })
}

@Serializable
data class BookSummary(val id: String, val name: String, val emoji: String? = null, val tuneIds: List<String>? = null)

@Serializable
data class Library(val user: SignedInUser, val tunes: List<SavedTune>, val books: List<BookSummary>, val sharedBooks: List<BookSummary>)

/** A tunebook's entry in playing order: one tune, or a set of tunes played one after another. */
@Serializable
data class BookSection(val kind: String, val entryId: String, val tune: SavedTune? = null, val name: String? = null, val tunes: List<SavedTune>? = null) {
    val members: List<SavedTune> get() = tune?.let(::listOf) ?: tunes.orEmpty()
    /** The set's name; null for a single tune. */
    val set: String? get() = name.takeIf { kind == "set" }
}

/** A tunebook as /api/app/books/{id} answers it. */
@Serializable
data class BookDetail(
    val book: Book,
    val sections: List<BookSection>,
    /** Play-along recordings by setting ID. */
    val playalongs: Map<String, List<PlayalongTrack>> = emptyMap(),
    val defaultSound: Int = 74,
) {
    @Serializable
    data class Book(val id: String, val name: String, val emoji: String? = null, val isOwner: Boolean = false)
}

@Serializable
data class BookRef(val id: String, val name: String)

/** A tune as the finder shows it: /api/finder's answer for a heard or searched tune. */
@Serializable
data class FinderTune(
    val tuneId: Int,
    val settingId: Int? = null,
    val title: String,
    val kind: String? = null,
    val meter: String? = null,
    val mode: String? = null,
    val abc: String? = null,
    val tunebooks: Int? = null,
    val level: Level? = null,
    val savedId: String? = null,
    val inBooks: List<BookRef>? = null,
) {
    val displayTitle: String get() = displayTitle(title)
    val meta: String get() = meta(kind, mode)
    val isKnown: Boolean get() = level?.known == true

    /** Where a named tune stands, said in full: "You can lead this one. It's in Madrid Session." */
    val standingSentence: String
        get() {
            val ability = when (level) {
                Level.Learning -> "You're learning this one."
                Level.Learned -> "You can play along with this one."
                Level.Mastered -> "You can lead this one."
                else -> null
            }
            val books = inBooks.orEmpty()
            val where = when {
                books.size == 1 -> "It's in ${books[0].name}."
                books.size > 1 -> "It's in ${books.size} of your tunebooks."
                savedId != null && (level ?: Level.Unlearned) == Level.Unlearned -> "It's in your library."
                else -> null
            }
            return listOfNotNull(ability, where).joinToString(" ")
        }
}

@Serializable
data class RecordingSummary(
    val id: String,
    val title: String,
    val recordedAt: String,
    val durationMs: Int? = null,
    val tunes: Int = 0,
    val firstTunes: List<String> = emptyList(),
    /** Where each named tune plays, for the bar coloured tune by tune. */
    val segments: List<RecordingSegment> = emptyList(),
)

/** One recording for its page: its audio (a signed URL) and its setlist, each tune with where it stands for you. */
@Serializable
data class RecordingDetail(
    val id: String,
    val title: String,
    val recordedAt: String,
    val durationMs: Long? = null,
    val audioUrl: String? = null,
    val tunes: List<Entry> = emptyList(),
) {
    @Serializable
    data class Entry(
        val id: String,
        val tuneId: Int,
        val settingId: Int,
        val startMs: Long,
        val endMs: Long,
        val title: String,
        val kind: String? = null,
        val meter: String? = null,
        val mode: String? = null,
        val abc: String = "",
        val practice: Practice = Practice(),
        val savedId: String? = null,
    ) {
        val displayTitle: String get() = displayTitle(title)
        val meta: String get() = meta(kind, mode)
        val finderTune: FinderTune get() = FinderTune(tuneId, settingId, title, kind, meter, mode, abc, level = practice.level, savedId = savedId)
    }
}

@Serializable
data class RecordingSegment(val tuneId: Int, val startMs: Long, val endMs: Long)

/** A tune in a session's setlist, as it uploads: where it plays in the recording. */
@Serializable
data class SetlistEntry(
    val tuneId: Int,
    val settingId: Int,
    val title: String,
    val startMs: Long,
    val endMs: Long = 0,
    /** Swiped away as wrong: it uploads anyway, as a labelled mistake for the finder to learn from. */
    val rejected: Boolean = false,
)

/** A session recorded on this phone, kept (audio beside it) until it has uploaded. */
@Serializable
data class LocalRecording(
    val id: String,
    val name: String,
    /** ISO 8601. */
    val recordedAt: String,
    val durationMs: Long = 0,
    val tunes: List<SetlistEntry> = emptyList(),
    val finished: Boolean = false,
)

private val TRAILING_ARTICLE = Regex("^(.+), (The|A|An)$")
private val KEY = Regex("^([A-G][#b]?)(?=[a-z])")

/** "Silver Spear, The" becomes "The Silver Spear", as people say it. */
fun displayTitle(title: String) = TRAILING_ARTICLE.matchEntire(title)?.let { "${it.groupValues[2]} ${it.groupValues[1]}" } ?: title

/** The Session writes keys as "Dmajor"; people read "D major". */
fun keyName(mode: String) = KEY.replace(mode) { "${it.groupValues[1]} " }

/** "Reel, D major". */
fun meta(kind: String?, mode: String?) =
    listOfNotNull(kind?.takeIf { it.isNotEmpty() }?.replaceFirstChar { it.uppercase() }, mode?.takeIf { it.isNotEmpty() }?.let(::keyName)).joinToString(", ")

/** Who you are as a player, as /api/app/me answers it. */
@Serializable
data class Passport(
    val user: SignedInUser,
    val repertoire: Repertoire,
    val types: List<TypeCount>,
    val keys: List<KeyCount>,
    val popularity: Popularity,
    val personas: Personas,
    val favourites: List<Favourite>,
    val sessions: Sessions,
    /** "A jig person who digs deep cuts." */
    val headline: String = "",
    val standards: Standards = Standards(),
    val stamps: List<Stamp> = emptyList(),
) {
    @Serializable data class Repertoire(val tunes: Int, val playable: Int, val counts: Map<String, Int>, val tunebooks: Int) {
        fun count(level: Level) = counts[level.name.lowercase()] ?: 0
    }
    @Serializable data class TypeCount(val kind: String, val total: Int, val playable: Int)
    @Serializable data class KeyCount(val mode: String, val total: Int)
    @Serializable data class Band(val band: Int, val label: String, val tunes: Int, val playable: Int)
    @Serializable data class Rarest(val id: String, val title: String, val band: Int)
    @Serializable data class Popularity(val bands: List<Band>, val rarest: Rarest? = null)
    @Serializable data class Persona(val title: String, val line: String)
    @Serializable data class Personas(val type: Persona? = null, val popularity: Persona? = null)
    @Serializable data class Favourite(
        val id: String, val tuneId: Int, val settingId: Int, val title: String, val emoji: String? = null, val kind: String? = null,
        val meter: String? = null, val mode: String? = null, val abc: String, val practice: Practice = Practice(), val starred: Int = 0, val heard: Int = 0,
    ) {
        val asSaved: SavedTune get() = SavedTune(id, tuneId, settingId, title, emoji, kind, meter, mode, abc, practice)
    }
    @Serializable data class MostHeard(val tuneId: Int, val title: String, val times: Int)
    @Serializable data class Sessions(
        val recordings: Int, val minutes: Int, val tunesHeard: Int, val mostHeard: MostHeard? = null,
        val byMonth: List<Month> = emptyList(), val biggestNight: BiggestNight? = null, val longestMs: Long = 0,
    )
    @Serializable data class Month(val month: String, val sessions: Int, val minutes: Int)
    @Serializable data class BiggestNight(val id: String, val recordedAt: String, val tunes: Int)
    /** The 100 tunes most held on The Session, each with where you stand with it. */
    @Serializable data class Standards(val tunes: List<Standard> = emptyList(), val total: Int = 0, val playable: Int = 0, val learning: Int = 0, val wanted: Int = 0)
    @Serializable data class Standard(val tuneId: Int, val title: String, val kind: String? = null, val level: Level? = null, val savedId: String? = null)
    @Serializable data class Progress(val have: Int, val need: Int)
    @Serializable data class Stamp(val id: String, val title: String, val line: String, val earned: Boolean, val at: String? = null, val progress: Progress? = null)
}

/** A play-along recording a score can follow (the web's Playalong); its timing goes back to the player as it came. */
@Serializable
data class PlayalongTrack(
    val id: String,
    val label: String,
    val url: String,
    val durationMs: Int,
    val bpm: Double? = null,
    /** Recorded from another setting of the same tune in the same key. */
    val otherSetting: Boolean = false,
    val timing: kotlinx.serialization.json.JsonElement? = null,
)

/** One of your tunes with its play-alongs and the sound you play scores with, as /api/app/tunes/{id} answers it. */
@Serializable
data class TuneDetail(val tune: SavedTune, val playalongs: List<PlayalongTrack> = emptyList(), val defaultSound: Int = 74, val heard: List<TuneHeard> = emptyList())

/** A moment in one of your recordings where a tune was named. */
@Serializable
data class TuneHeard(val recordingId: String, val title: String, val recordedAt: String, val startMs: Long, val endMs: Long)
