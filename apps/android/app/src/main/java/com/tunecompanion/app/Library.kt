// The signed-in person and their library, loaded from /api/app/library. Signed out, the app still
// names tunes; the reading layer asks them to sign in.
package com.tunecompanion.app

import com.tunecompanion.app.api.ApiException
import com.tunecompanion.app.api.BookSummary
import com.tunecompanion.app.api.SavedTune
import com.tunecompanion.app.api.SignedInUser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LibraryState(
    val phase: Phase = Phase.Loading,
    val user: SignedInUser? = null,
    val tunes: List<SavedTune> = emptyList(),
    val books: List<BookSummary> = emptyList(),
    val sharedBooks: List<BookSummary> = emptyList(),
    val problem: String? = null,
) {
    enum class Phase { SignedOut, Loading, Ready, Failed }
}

object Library {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(LibraryState())
    val state: StateFlow<LibraryState> = _state

    val signedIn: Boolean get() = Services.api.signedIn

    fun load() = scope.launch { refresh() }

    suspend fun refresh() {
        if (!Services.api.signedIn) { _state.value = LibraryState(LibraryState.Phase.SignedOut); return }
        if (_state.value.user == null) _state.update { it.copy(phase = LibraryState.Phase.Loading) }
        try {
            val library = Services.api.library()
            _state.value = LibraryState(LibraryState.Phase.Ready, library.user, library.tunes, library.books, library.sharedBooks)
        } catch (signedOut: ApiException) {
            if (signedOut.status == 401) { Services.api.forgetSession(); _state.value = LibraryState(LibraryState.Phase.SignedOut) }
            else if (_state.value.user == null) _state.update { it.copy(phase = LibraryState.Phase.Failed, problem = "Could not load your tunes. Pull down to try again.") }
        } catch (_: Exception) {
            if (_state.value.user == null) _state.update { it.copy(phase = LibraryState.Phase.Failed, problem = "Could not load your tunes. Pull down to try again.") }
        }
    }

    suspend fun signIn(email: String, password: String) { Services.api.signIn(email, password); refresh() }
    suspend fun signUp(name: String, email: String, password: String) = Services.api.signUp(name, email, password)
    suspend fun signOut() { Services.api.signOut(); _state.value = LibraryState(LibraryState.Phase.SignedOut) }

    /** A tune changed elsewhere (its progress set). */
    fun update(tune: SavedTune) = _state.update { s -> s.copy(tunes = s.tunes.map { if (it.id == tune.id) tune else it }) }
}
