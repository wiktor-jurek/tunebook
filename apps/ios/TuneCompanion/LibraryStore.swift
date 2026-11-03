// The signed-in person and their library, loaded from /api/app/library. Signed out, the app still
// names tunes; the Tunes tab asks them to sign in.

import API
import Foundation
import Observation

@MainActor
@Observable
final class LibraryStore {
    enum State: Equatable { case signedOut, loading, ready, failed(String) }

    private(set) var state: State = .loading
    private(set) var user: SignedInUser?
    private(set) var tunes: [SavedTune] = []
    private(set) var books: [BookSummary] = []
    private(set) var sharedBooks: [BookSummary] = []

    let api = APIClient.current
    /// Something asked for an account (Learn later while signed out): the app shows sign-in.
    var askToSignIn = false
    /// A tunebook to open on the Tunes tab (one just made).
    var openingBook: BookSummary?

    func open(bookId: String, name: String) {
        openingBook = try? JSONDecoder().decode(BookSummary.self, from: JSONSerialization.data(withJSONObject: ["id": bookId, "name": name]))
    }

    init() {
        if !api.isSignedIn { state = .signedOut }
    }

    var signedIn: Bool { user != nil || api.isSignedIn }

    func load() async {
        guard api.isSignedIn else { state = .signedOut; return }
        if user == nil { state = .loading }
        do {
            let library = try await api.library()
            user = library.user
            tunes = library.tunes
            books = library.books
            sharedBooks = library.sharedBooks
            state = .ready
        } catch APIError.signedOut {
            api.forgetSession()
            clear()
        } catch {
            if user == nil { state = .failed("Could not load your tunes. Pull down to try again.") }
        }
    }

    /// A tune changed elsewhere (its progress set on its page).
    func update(_ tune: SavedTune) {
        if let index = tunes.firstIndex(where: { $0.id == tune.id }) { tunes[index] = tune }
    }

    func signIn(email: String, password: String) async throws {
        try await api.signIn(email: email, password: password)
        await load()
    }

    func signUp(name: String, email: String, password: String) async throws {
        try await api.signUp(name: name, email: email, password: password)
    }

    func signInWithApple(idToken: String, nonce: String, firstName: String?, lastName: String?) async throws {
        try await api.signInWithApple(idToken: idToken, nonce: nonce, firstName: firstName, lastName: lastName)
        await load()
    }

    func signInWithGoogle(idToken: String) async throws {
        try await api.signInWithGoogle(idToken: idToken)
        await load()
    }

    func signOut() async {
        await api.signOut()
        clear()
    }

    private func clear() {
        user = nil
        tunes = []
        books = []
        sharedBooks = []
        state = .signedOut
    }
}
