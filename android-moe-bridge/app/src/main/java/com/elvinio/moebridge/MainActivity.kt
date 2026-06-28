package com.elvinio.moebridge

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateUtils
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.elvinio.moebridge.databinding.ActivityMainBinding
import com.elvinio.moebridge.db.AppDatabase
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private val prefs by lazy { Prefs(this) }

    private val signInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        try {
            val account = GoogleSignIn.getSignedInAccountFromIntent(result.data)
                .getResult(com.google.android.gms.common.api.ApiException::class.java)
            prefs.account = account.email
            toast("Signed in: ${account.email}")
        } catch (e: Exception) {
            toast("Sign-in failed: ${e.message}")
        }
        refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        SyncWorker.ensurePeriodic(this)

        b.editPackages.setText(prefs.targetPackages)
        b.switchCaptureAll.isChecked = prefs.captureAll

        b.btnAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        b.btnSignIn.setOnClickListener { signIn() }
        b.btnSyncNow.setOnClickListener {
            SyncWorker.enqueueNow(this)
            toast("Sync queued")
        }
        b.btnSaveSettings.setOnClickListener {
            prefs.targetPackages = b.editPackages.text.toString()
            prefs.captureAll = b.switchCaptureAll.isChecked
            toast("Saved")
            refresh()
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun signIn() {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(Scope(DriveUploader.SCOPE))
            .build()
        signInLauncher.launch(GoogleSignIn.getClient(this, gso).signInIntent)
    }

    private fun accessibilityEnabled(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        val me = packageName + "/" + MoeAccessibilityService::class.java.name
        val enabled = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        return am.isEnabled && enabled.split(":").any { it.equals(me, ignoreCase = true) }
    }

    private fun refresh() {
        val signedIn = GoogleSignIn.getLastSignedInAccount(this)?.email ?: prefs.account
        val lastSync = if (prefs.lastSync == 0L) "never"
        else DateUtils.getRelativeTimeSpanString(prefs.lastSync).toString()
        val filter = if (prefs.captureAll) "ALL apps (debug)" else prefs.targetPackages

        lifecycleScope.launch {
            val dao = AppDatabase.get(this@MainActivity).captureDao()
            val pending = withContext(Dispatchers.IO) { dao.pendingCount() }
            val total = withContext(Dispatchers.IO) { dao.total() }
            val recent = withContext(Dispatchers.IO) { dao.recent(15) }

            b.statusView.text = buildString {
                appendLine("Accessibility : ${if (accessibilityEnabled()) "ON ✓" else "OFF ✗ (tap below)"}")
                appendLine("Drive account : ${signedIn ?: "not signed in ✗"}")
                appendLine("Capturing from: $filter")
                appendLine("Captured      : $total ($pending pending)")
                append("Last sync     : $lastSync")
            }
            b.capturesView.text = if (recent.isEmpty()) "(none yet)"
            else recent.joinToString("\n\n") { c ->
                val flag = if (c.syncedAt == null) "•" else "✓"
                "$flag [${c.screen}] ${c.title.take(60)}\n  ${c.text.replace("\n", " ").take(120)}"
            }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
