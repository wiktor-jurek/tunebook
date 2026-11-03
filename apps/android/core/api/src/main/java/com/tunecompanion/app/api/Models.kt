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
data class SignedInUser(val id: String, val name: String, val email: String)

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
