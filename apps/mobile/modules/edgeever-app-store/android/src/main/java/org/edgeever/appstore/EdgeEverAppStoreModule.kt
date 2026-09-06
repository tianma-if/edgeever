package org.edgeever.appstore

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val GOOGLE_PLAY_PACKAGE = "com.android.vending"
private const val RESULT_DISABLED = "disabled"
private const val RESULT_NOT_INSTALLED = "not-installed"
private const val RESULT_OPENED = "opened"
private const val RESULT_UNAVAILABLE = "unavailable"

class EdgeEverAppStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EdgeEverAppStore")

    AsyncFunction("openGooglePlayDetails") { applicationId: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction RESULT_UNAVAILABLE
      val detailsUri = Uri.Builder()
        .scheme("market")
        .authority("details")
        .appendQueryParameter("id", applicationId)
        .build()
      val intent = Intent(Intent.ACTION_VIEW, detailsUri).apply {
        setPackage(GOOGLE_PLAY_PACKAGE)
      }

      try {
        activity.startActivity(intent)
        RESULT_OPENED
      } catch (_: ActivityNotFoundException) {
        getGooglePlayFailureReason(activity.packageManager)
      } catch (_: SecurityException) {
        getGooglePlayFailureReason(activity.packageManager)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun getGooglePlayFailureReason(packageManager: PackageManager): String {
    return try {
      val applicationInfo = packageManager.getApplicationInfo(
        GOOGLE_PLAY_PACKAGE,
        PackageManager.MATCH_DISABLED_COMPONENTS
      )
      val enabledSetting = packageManager.getApplicationEnabledSetting(GOOGLE_PLAY_PACKAGE)
      val disabled = !applicationInfo.enabled || enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
        enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER ||
        enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED
      if (disabled) RESULT_DISABLED else RESULT_UNAVAILABLE
    } catch (_: PackageManager.NameNotFoundException) {
      RESULT_NOT_INSTALLED
    }
  }
}
