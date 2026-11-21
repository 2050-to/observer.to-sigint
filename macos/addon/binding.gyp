{
  "targets": [
    {
      "target_name": "scanner",
      "sources": ["scanner.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"]
      },
      "link_settings": {
        "libraries": [
          "-framework CoreWLAN",
          "-framework CoreBluetooth",
          "-framework CoreLocation",
          "-framework AppKit",
          "-framework Foundation"
        ]
      }
    }
  ]
}
