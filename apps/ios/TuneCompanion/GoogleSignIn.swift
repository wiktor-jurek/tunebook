// Sign in with Google, without Google's SDK: OAuth with PKCE in the system's secure sign-in sheet,
// using the app's own Google client (an iOS client has no secret), then Google's ID token goes to
// the server, which checks it against Google's keys and signs the person in.

import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static var clientId: String? { Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String }

    enum Failure: Error { case cancelled, failed }

    private var session: ASWebAuthenticationSession?

    /// Google's ID token for the account the person picks.
    func idToken() async throws -> String {
        guard let clientId = Self.clientId else { throw Failure.failed }
        // Google's iOS clients redirect to the client ID reversed, as a URL scheme.
        let scheme = clientId.split(separator: ".").reversed().joined(separator: ".")
        let redirect = "\(scheme):/oauthredirect"
        let verifier = Self.random(48), state = Self.random(16)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL

        var authorize = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        authorize.queryItems = [
            .init(name: "client_id", value: clientId), .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state), .init(name: "prompt", value: "select_account"),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorize.url!, callback: .customScheme(scheme)) { url, error in
                if let url { continuation.resume(returning: url) }
                else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { continuation.resume(throwing: Failure.cancelled) }
                else { continuation.resume(throwing: Failure.failed) }
            }
            session.presentationContextProvider = self
            self.session = session
            session.start()
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw Failure.failed }

        var token = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        token.httpMethod = "POST"
        token.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [.init(name: "code", value: code), .init(name: "client_id", value: clientId),
                           .init(name: "redirect_uri", value: redirect), .init(name: "grant_type", value: "authorization_code"),
                           .init(name: "code_verifier", value: verifier)]
        token.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        let (data, _) = try await URLSession.shared.data(for: token)
        struct Tokens: Decodable { let id_token: String? }
        guard let idToken = try JSONDecoder().decode(Tokens.self, from: data).id_token else { throw Failure.failed }
        return idToken
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.compactMap(\.keyWindow).first ?? ASPresentationAnchor(windowScene: scenes.first!)
        }
    }

    private static func random(_ bytes: Int) -> String {
        Data((0..<bytes).map { _ in UInt8.random(in: 0...255) }).base64URL
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
