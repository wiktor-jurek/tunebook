// The Tune Companion API (apps/web's routes). Signed-in calls carry the session token from
// better-auth's bearer plugin; the token lives in the Keychain (see Account).

import Foundation

public struct APIClient: Sendable {
    public static let production = URL(string: "https://tunecompanion.com")!

    /// The server this build talks to: production, unless the `apiBase` default is set (for development, launch with
    /// `-apiBase http://localhost:3000`).
    public static var current: APIClient {
        let override = UserDefaults.standard.string(forKey: "apiBase").flatMap(URL.init(string:))
        return APIClient(base: override ?? production)
    }

    public let base: URL
    let session: URLSession

    public init(base: URL, session: URLSession = .shared) {
        self.base = base
        self.session = session
    }

    /// True when the server answers /api/health.
    public func healthy() async -> Bool {
        guard let (_, response) = try? await session.data(from: base.appending(path: "api/health")) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// A request to `path`, signed in if there is a session.
    func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: (any Encodable)? = nil) throws -> URLRequest {
        var url = base.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token = Keychain.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }

    /// Sends a request and decodes its JSON answer; a 401 means the session has ended.
    func send<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.signedOut }
        guard (200..<300).contains(status) else {
            throw APIError.server(status: status, message: (try? JSONDecoder().decode(ErrorBody.self, from: data))?.text)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

public enum APIError: Error, LocalizedError, Equatable {
    case signedOut
    case server(status: Int, message: String?)

    public var errorDescription: String? {
        switch self {
        case .signedOut: "You're signed out. Sign in again."
        case let .server(_, message): message ?? "Something went wrong. Try again."
        }
    }
}

/// The two shapes errors come in: better-auth's `{ message, code }` and the app routes' `{ error }`.
struct ErrorBody: Decodable {
    let message: String?
    let error: String?
    let code: String?
    var text: String? { message ?? error }
}
