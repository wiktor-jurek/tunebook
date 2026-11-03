// Signing in and out against better-auth: email and password, or an Apple ID token from Sign in
// with Apple. A successful sign-in answers with the session token in `set-auth-token`.

import Foundation

public struct SignedInUser: Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let email: String
}

public enum AccountError: Error, LocalizedError, Equatable {
    case wrongPassword
    case unverified
    case taken
    case weakPassword
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .wrongPassword: "That email and password don't match."
        case .unverified: "Check your email for a link to verify your address, then sign in."
        case .taken: "There's already an account with that email. Sign in instead."
        case .weakPassword: "Use a password of at least 8 characters."
        case let .message(text): text
        }
    }
}

extension APIClient {
    public var isSignedIn: Bool { Keychain.token != nil }

    public func signIn(email: String, password: String) async throws {
        struct Body: Encodable { let email: String, password: String, rememberMe = true }
        try await authenticate("api/auth/sign-in/email", body: Body(email: email, password: password))
    }

    /// Creates an account; the server emails a link to verify it before the first sign-in.
    public func signUp(name: String, email: String, password: String) async throws {
        let request = try request("api/auth/sign-up/email", method: "POST", body: ["name": name, "email": email, "password": password,
                                                                                   "callbackURL": base.appending(path: "/").absoluteString])
        let (data, response) = try await session.data(for: request)
        try check(data, response)
    }

    /// `idToken` from Sign in with Apple; `nonce` is the raw nonce whose SHA-256 went into Apple's request. Apple gives
    /// the person's name only the first time they sign in, so it goes along when there is one.
    public func signInWithApple(idToken: String, nonce: String, firstName: String?, lastName: String?) async throws {
        struct Body: Encodable {
            struct Name: Encodable { let firstName: String?, lastName: String? }
            struct Person: Encodable { let name: Name }
            struct Token: Encodable { let token: String, nonce: String, user: Person? }
            let provider = "apple"
            let idToken: Token
        }
        let person = firstName != nil || lastName != nil ? Body.Person(name: .init(firstName: firstName, lastName: lastName)) : nil
        try await authenticate("api/auth/sign-in/social", body: Body(idToken: .init(token: idToken, nonce: nonce, user: person)))
    }

    /// `idToken` from Google's sign-in, for the app's own Google client.
    public func signInWithGoogle(idToken: String) async throws {
        struct Body: Encodable {
            struct Token: Encodable { let token: String }
            let provider = "google"
            let idToken: Token
        }
        try await authenticate("api/auth/sign-in/social", body: Body(idToken: .init(token: idToken)))
    }

    public func signOut() async {
        if let request = try? request("api/auth/sign-out", method: "POST", body: [String: String]()) {
            _ = try? await session.data(for: request)
        }
        Keychain.token = nil
    }

    /// Forgets the session without asking the server (it has already ended).
    public func forgetSession() { Keychain.token = nil }

    private func authenticate(_ path: String, body: some Encodable) async throws {
        Keychain.token = nil
        let request = try request(path, method: "POST", body: body)
        let (data, response) = try await session.data(for: request)
        try check(data, response)
        guard let token = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty else {
            throw AccountError.message("Signing in didn't work. Try again.")
        }
        Keychain.token = token
    }

    private func check(_ data: Data, _ response: URLResponse) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard !(200..<300).contains(status) else { return }
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        switch body?.code {
        case "INVALID_EMAIL_OR_PASSWORD": throw AccountError.wrongPassword
        case "EMAIL_NOT_VERIFIED": throw AccountError.unverified
        case "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": throw AccountError.taken
        case "PASSWORD_TOO_SHORT": throw AccountError.weakPassword
        default: throw AccountError.message(body?.text ?? "Something went wrong. Try again.")
        }
    }
}
