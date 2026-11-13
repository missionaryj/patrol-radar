# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Line numbers in the release mapping file, so Play can deobfuscate stack traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor 7.6.9 keeps annotated plugin classes, but not these annotation types.
# R8 full mode treats types that are only reached via getAnnotation() as unused and
# then nulls out PluginHandle's cached @CapacitorPlugin, which breaks permission
# requests and the JS bridge method table. Plugin method names themselves are kept
# by Capacitor's consumer rules.
-keep @interface com.getcapacitor.annotation.** { *; }
-keep @interface com.getcapacitor.PluginMethod { *; }
-keep @interface com.getcapacitor.NativePlugin { *; }
