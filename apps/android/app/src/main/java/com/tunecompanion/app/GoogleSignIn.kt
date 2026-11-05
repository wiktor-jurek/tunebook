// Sign in with Google through Android's Credential Manager: the system's account sheet gives Google's
// ID token for the website's client, and the server checks it against Google's keys and signs the
// person in (as the iPhone app's sign-in does with its own client).
package com.tunecompanion.app

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.tunecompanion.app.api.AccountException

object GoogleSignIn {
    /** The person closed the sheet: nothing to say. */
    class Cancelled : Exception()

    /** Google's ID token for the account the person picks. [context] must be an activity: the sheet shows over it. */
    suspend fun idToken(context: Context): String {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_SERVER_CLIENT_ID).build())
            .build()
        val credential = try {
            CredentialManager.create(context).getCredential(context, request).credential
        } catch (_: GetCredentialCancellationException) {
            throw Cancelled()
        } catch (_: NoCredentialException) {
            throw AccountException("Add a Google account to this phone, then try again.")
        } catch (cause: GetCredentialException) {
            Log.w("TuneCompanion", "Sign in with Google failed: ${cause.type}", cause)
            throw AccountException("Signing in with Google didn't work. Try again.")
        }
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleIdTokenCredential.createFrom(credential.data).idToken
        }
        throw AccountException("Signing in with Google didn't work. Try again.")
    }
}
