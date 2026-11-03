// Signing in: Sign in with Apple, or email and password (to sign in or create an account). The
// web's sign-in page offers the same accounts, so one account works everywhere.

import AuthenticationServices
import CryptoKit
import DesignSystem
import SwiftUI

struct SignInView: View {
    @Environment(LibraryStore.self) private var library
    @State private var emailForm = false
    @State private var problem: String?
    @State private var nonce = ""

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            BrandMark().frame(width: 64, height: 64)
            Text("Your tunes, at the session").font(.system(size: 28, design: .serif)).multilineTextAlignment(.center)
            Text("Sign in to see your tunes and tunebooks, and keep the tunes you hear. You can name tunes without an account.")
                .font(.subheadline).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
                .padding(.bottom, 10)
            SignInWithAppleButton(.signIn) { request in
                nonce = Self.randomNonce()
                request.requestedScopes = [.fullName, .email]
                request.nonce = Self.sha256(nonce)
            } onCompletion: { result in
                Task { await finishApple(result) }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 50)
            .clipShape(.capsule)
            if GoogleSignIn.clientId != nil {
                Button { Task { await finishGoogle() } } label: {
                    Text("Continue with Google").font(.body.weight(.medium)).frame(maxWidth: .infinity).frame(height: 40)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(Palette.foreground)
            }
            Button { emailForm = true } label: {
                Label("Continue with email", systemImage: "envelope").frame(maxWidth: .infinity).frame(height: 40)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(Palette.foreground)
            if let problem { Text(problem).font(.footnote).foregroundStyle(Palette.danger).multilineTextAlignment(.center) }
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 28)
        .sheet(isPresented: $emailForm) { EmailSignIn() }
    }

    private func finishGoogle() async {
        problem = nil
        do {
            let token = try await GoogleSignIn().idToken()
            try await library.signInWithGoogle(idToken: token)
        } catch GoogleSignIn.Failure.cancelled {
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? "Signing in with Google didn't work. Try again."
        }
    }

    private func finishApple(_ result: Result<ASAuthorization, Error>) async {
        problem = nil
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
                problem = "Sign in with Apple didn't work. Try again."
                return
            }
            do {
                try await library.signInWithApple(idToken: token, nonce: nonce, firstName: credential.fullName?.givenName,
                                                  lastName: credential.fullName?.familyName)
            } catch {
                problem = error.localizedDescription
            }
        case let .failure(error):
            if (error as? ASAuthorizationError)?.code != .canceled { problem = "Sign in with Apple didn't work. Try again." }
        }
    }

    private static func randomNonce() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    private static func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Email and password, to sign in or to create an account (which the server asks to verify by email first).
private struct EmailSignIn: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var creating = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var sent = false

    var body: some View {
        NavigationStack {
            Form {
                Picker("", selection: $creating) {
                    Text("Sign in").tag(false)
                    Text("Create account").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                Section {
                    if creating { TextField("Name", text: $name).textContentType(.name) }
                    TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(creating ? .newPassword : .password)
                } footer: {
                    if let problem { Text(problem).foregroundStyle(Palette.danger) }
                    else if sent { Text("Check your email for a link to verify your address, then sign in here.") }
                    else if creating { Text("At least 8 characters. We'll email a link to verify your address.") }
                }
                Section {
                    Button(creating ? "Create account" : "Sign in") { Task { await submit() } }
                        .disabled(busy || email.isEmpty || password.isEmpty || creating && name.isEmpty)
                    if !creating {
                        Button("Forgot your password?") { openURL(library.api.base.appending(path: "forgot-password")) }
                            .tint(Palette.mutedForeground)
                    }
                }
            }
            .navigationTitle(creating ? "Create account" : "Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onChange(of: creating) { problem = nil }
        }
        .presentationDetents([.large])
    }

    private func submit() async {
        busy = true
        problem = nil
        defer { busy = false }
        do {
            if creating {
                try await library.signUp(name: name, email: email, password: password)
                sent = true
                creating = false
            } else {
                try await library.signIn(email: email, password: password)
                dismiss()
            }
        } catch {
            problem = error.localizedDescription
        }
    }
}
