; Per-user Explorer verb. Runtime registration refreshes the label and exe path.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\EdgeEver" "" "发送到 EdgeEver"
  WriteRegStr HKCU "Software\Classes\*\shell\EdgeEver" "Icon" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0"
  WriteRegStr HKCU "Software\Classes\*\shell\EdgeEver" "MultiSelectModel" "Document"
  WriteRegStr HKCU "Software\Classes\*\shell\EdgeEver\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --share-file $\"%1$\""
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\EdgeEver"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EdgeEver"
  ClearErrors
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "EdgeEver"
  ClearErrors
!macroend
