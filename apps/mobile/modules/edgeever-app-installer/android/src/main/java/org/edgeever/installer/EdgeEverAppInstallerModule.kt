package org.edgeever.installer

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.exception.toCodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
private const val INSTALL_PERMISSION_REQUEST_CODE = 2401

class EdgeEverAppInstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingFile: File? = null
  private var pendingPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("EdgeEverAppInstaller")

    AsyncFunction("install") { fileUri: String, promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("ERR_INSTALL_IN_PROGRESS", "Another APK install request is already in progress", null)
        return@AsyncFunction
      }

      try {
        val file = resolveDownloadedApk(fileUri)
        if (canRequestPackageInstalls()) {
          openPackageInstaller(file)
          promise.resolve(true)
        } else {
          pendingFile = file
          pendingPromise = promise
          val permissionIntent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")
          )
          appContext.throwingActivity.startActivityForResult(permissionIntent, INSTALL_PERMISSION_REQUEST_CODE)
        }
      } catch (error: Throwable) {
        pendingFile = null
        pendingPromise = null
        promise.reject(error.toCodedException())
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != INSTALL_PERMISSION_REQUEST_CODE) {
        return@OnActivityResult
      }

      val promise = pendingPromise ?: return@OnActivityResult
      val file = pendingFile
      pendingPromise = null
      pendingFile = null

      if (file == null || !canRequestPackageInstalls()) {
        promise.resolve(false)
        return@OnActivityResult
      }

      try {
        openPackageInstaller(file)
        promise.resolve(true)
      } catch (error: Throwable) {
        promise.reject(error.toCodedException())
      }
    }
  }

  private fun canRequestPackageInstalls(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
  }

  private fun resolveDownloadedApk(fileUri: String): File {
    val uri = Uri.parse(fileUri)
    require(uri.scheme == "file") { "Expected a local APK file URI" }
    val path = requireNotNull(uri.path) { "APK file URI has no path" }
    val file = File(path).canonicalFile
    val cacheDirectory = context.cacheDir.canonicalFile
    require(file.path.startsWith(cacheDirectory.path + File.separator)) { "APK must be inside the app cache" }
    require(file.isFile && file.extension.equals("apk", ignoreCase = true)) { "Downloaded APK does not exist" }
    return file
  }

  private fun openPackageInstaller(file: File) {
    val activity = appContext.throwingActivity
    val contentUri = FileProvider.getUriForFile(
      context,
      "${context.packageName}.FileSystemFileProvider",
      file
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(contentUri, APK_MIME_TYPE)
      clipData = ClipData.newRawUri("EdgeEver update", contentUri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(intent)
  }
}
