// Talks to the Tune Companion server. Signed-in calls carry the session token from better-auth's
// bearer plugin, kept in this app's private storage; a sign-in answers with it in `set-auth-token`.
package com.tunecompanion.app.api

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.serializer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class ApiException(val status: Int, message: String) : Exception(message)

/** Signing in failed for a reason the person can act on. */
class AccountException(message: String) : Exception(message)

class ApiClient(context: Context, val base: String) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    var token: String?
        get() = prefs.getString("token", null)
        private set(value) { prefs.edit().apply { if (value == null) remove("token") else putString("token", value) }.apply() }

    val signedIn: Boolean get() = token != null

    // MARK: Requests

    suspend fun <T> get(path: String, serializer: KSerializer<T>): T = send("GET", path, null, serializer)

    suspend inline fun <reified T> get(path: String): T = get(path, serializer<T>())

    suspend fun <T> send(method: String, path: String, body: String?, serializer: KSerializer<T>): T {
        val (status, text, _) = raw(method, path, body)
        if (status == 401) throw ApiException(401, "You're signed out. Sign in again.")
        if (status !in 200..299) throw ApiException(status, errorText(text) ?: "Something went wrong. Try again.")
        return json.decodeFromString(serializer, text)
    }

    /** One request: status, body text and the session token header, if any. */
    suspend fun raw(method: String, path: String, body: String?): Triple<Int, String, String?> = withContext(Dispatchers.IO) {
        val connection = URL(base.trimEnd('/') + "/" + path.trimStart('/')).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            Triple(status, stream?.bufferedReader()?.readText().orEmpty(), connection.getHeaderField("set-auth-token"))
        } finally {
            connection.disconnect()
        }
    }

    private fun errorText(text: String): String? = runCatching {
        val body = json.parseToJsonElement(text).jsonObject
        (body["message"] ?: body["error"])?.jsonPrimitive?.content
    }.getOrNull()

    private fun errorCode(text: String): String? = runCatching { json.parseToJsonElement(text).jsonObject["code"]?.jsonPrimitive?.content }.getOrNull()

    // MARK: Account

    suspend fun signIn(email: String, password: String) =
        authenticate("api/auth/sign-in/email", buildJsonObject { put("email", email); put("password", password); put("rememberMe", true) })

    /** Creates an account; the server emails a link to verify it before the first sign-in. */
    suspend fun signUp(name: String, email: String, password: String) {
        val (status, text, _) = raw("POST", "api/auth/sign-up/email",
            buildJsonObject { put("name", name); put("email", email); put("password", password); put("callbackURL", "$base/") }.toString())
        if (status !in 200..299) throw accountError(text)
    }

    /** Google's ID token (the server accepts the app's Google clients as its audience). */
    suspend fun signInWithGoogle(idToken: String) = authenticate("api/auth/sign-in/social",
        buildJsonObject { put("provider", "google"); put("idToken", buildJsonObject { put("token", idToken) }) })

    suspend fun signOut() {
        runCatching { raw("POST", "api/auth/sign-out", "{}") }
        token = null
    }

    /** Forgets the session without asking the server (it has already ended). */
    fun forgetSession() { token = null }

    private suspend fun authenticate(path: String, body: JsonObject) {
        token = null
        val (status, text, newToken) = raw("POST", path, body.toString())
        if (status !in 200..299) throw accountError(text)
        token = newToken?.takeIf { it.isNotEmpty() } ?: throw AccountException("Signing in didn't work. Try again.")
    }

    private fun accountError(text: String) = AccountException(when (errorCode(text)) {
        "INVALID_EMAIL_OR_PASSWORD" -> "That email and password don't match."
        "EMAIL_NOT_VERIFIED" -> "Check your email for a link to verify your address, then sign in."
        "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" -> "There's already an account with that email. Sign in instead."
        "PASSWORD_TOO_SHORT" -> "Use a password of at least 8 characters."
        else -> errorText(text) ?: "Something went wrong. Try again."
    })

    // MARK: Library and the finder

    suspend fun library(): Library = get("api/app/library")

    /** Names for heard tune IDs (at most 20); signed in, with where each stands for you. */
    suspend fun finderTunes(ids: List<Int>): List<FinderTune> = get<FinderAnswer>("api/finder?ids=${ids.take(20).joinToString(",")}").tunes

    /** Tunes on The Session by name, for a tune someone calls out. */
    suspend fun searchTunes(query: String): List<FinderTune> = get<FinderAnswer>("api/finder?q=${URLEncoder.encode(query, "UTF-8")}").tunes

    /** Where a saved tune stands; `null` goes back to judging it from your recorded speed. */
    suspend fun setLevel(savedTuneId: String, level: Level?): Practice {
        val body = """{"operation":"level","level":${level?.let { json.encodeToString(Level.serializer(), it) } ?: "null"}}"""
        return send("POST", "api/tunes/$savedTuneId/practice", body, PracticeAnswer.serializer()).practice
    }

    /** Saves a setting to your library (or finds your copy) and returns the saved tune's ID. */
    suspend fun saveSetting(settingId: Int): String = send("POST", "api/catalog", """{"settingId":$settingId}""", SavedAnswer.serializer()).tuneId

    /** A tunebook's tunes and sets in playing order: yours, shared with you, or public. */
    suspend fun book(id: String): BookDetail = get("api/app/books/${URLEncoder.encode(id, "UTF-8")}")

    /** Who you are as a player: repertoire, types, popularity, favourites and sessions. */
    suspend fun passport(): Passport = get("api/app/me")

    /** One of your tunes, with its play-along recordings and your sound. */
    suspend fun tune(savedTuneId: String): TuneDetail = get("api/app/tunes/${URLEncoder.encode(savedTuneId, "UTF-8")}")

    suspend fun recordings(): List<RecordingSummary> = get<RecordingsAnswer>("api/app/recordings").recordings

    suspend fun recording(id: String): RecordingDetail = get<RecordingAnswer>("api/app/recordings/${URLEncoder.encode(id, "UTF-8")}").recording

    suspend fun deleteRecording(id: String) { send("DELETE", "api/recordings/${URLEncoder.encode(id, "UTF-8")}", null, JsonObject.serializer()) }

    /** Takes a tune off a recording's setlist (it stays, marked, as training data). */
    suspend fun removeRecordingTune(id: String, entryId: String) {
        send("PATCH", "api/recordings/${URLEncoder.encode(id, "UTF-8")}", buildJsonObject { put("operation", "removeTune"); put("entryId", entryId) }.toString(), JsonObject.serializer())
    }

    /**
     * Saves each setting not yet in the library, then puts them all, in order, into a new tunebook (the web's makeTunebook).
     * Each group of indexes into [settings] (tunes played back to back) becomes a set; a tune already in an earlier set
     * stays there. Returns the new book's ID.
     */
    suspend fun makeTunebook(name: String, settings: List<Pair<Int, String?>>, sets: List<List<Int>>): String {
        val savedIds = settings.map { (settingId, savedId) -> savedId ?: saveSetting(settingId) }
        val bookId = send("POST", "api/library", buildJsonObject { put("operation", "createBook"); put("name", name) }.toString(), BookCreated.serializer()).bookId
        for (id in savedIds.distinct()) {
            send("POST", "api/library", buildJsonObject { put("operation", "addToBook"); put("bookId", bookId); put("tuneId", id) }.toString(), JsonObject.serializer())
        }
        val grouped = mutableSetOf<String>()
        for (set in sets) {
            val tuneIds = set.map { savedIds[it] }.distinct().filter { it !in grouped }
            if (tuneIds.size < 2) continue
            send("POST", "api/sets", buildJsonObject { put("operation", "fromTunes"); put("bookId", bookId); put("tuneIds", JsonArray(tuneIds.map { JsonPrimitive(it) })) }.toString(), JsonObject.serializer())
            grouped += tuneIds
        }
        return bookId
    }

    /** Starts a recording's upload: its ID, and where to PUT the audio. */
    suspend fun createRecording(name: String, mime: String, recordedAt: String): Pair<String, String> {
        val body = buildJsonObject { put("name", name); put("mime", mime); put("recordedAt", recordedAt) }.toString()
        return send("POST", "api/recordings", body, CreatedAnswer.serializer()).let { it.id to it.uploadUrl }
    }

    /** Shows the uploaded recording, with its setlist. */
    suspend fun finishRecording(id: String, durationMs: Long, tunes: List<SetlistEntry>) {
        val body = buildJsonObject {
            put("operation", "finish"); put("durationMs", durationMs)
            put("tunes", JsonArray(tunes.map { tune -> buildJsonObject {
                put("tuneId", tune.tuneId); put("settingId", tune.settingId); put("startMs", tune.startMs); put("endMs", tune.endMs); put("rejected", tune.rejected)
            } }))
        }.toString()
        send("PATCH", "api/recordings/${URLEncoder.encode(id, "UTF-8")}", body, JsonObject.serializer())
    }

    /** PUTs a file to the storage bucket's signed [url] (no session: the URL is the permission), reporting progress 0 to 1. */
    suspend fun putFile(url: String, file: File, mime: String, progress: (Float) -> Unit) = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PUT"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("Content-Type", mime)
            val total = file.length()
            connection.setFixedLengthStreamingMode(total)
            connection.outputStream.use { out ->
                file.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var sent = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        sent += n
                        progress(if (total > 0) sent.toFloat() / total else 1f)
                    }
                }
            }
            val status = connection.responseCode
            if (status !in 200..299) throw ApiException(status, "The upload did not finish")
        } finally {
            connection.disconnect()
        }
    }

    @Serializable private data class FinderAnswer(val tunes: List<FinderTune>)
    @Serializable private data class PracticeAnswer(val practice: Practice)
    @Serializable private data class SavedAnswer(val tuneId: String)
    @Serializable private data class RecordingsAnswer(val recordings: List<RecordingSummary>)
    @Serializable private data class CreatedAnswer(val id: String, val uploadUrl: String)
    @Serializable private data class RecordingAnswer(val recording: RecordingDetail)
    @Serializable private data class BookCreated(val bookId: String)
}
