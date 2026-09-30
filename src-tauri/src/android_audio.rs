//! CPAL expects ndk-context, which Tao 0.35 no longer initializes automatically.
use jni::{objects::{GlobalRef, JObject}, JNIEnv, JavaVM};
use std::sync::OnceLock;

// Keep an Application (not Activity) global reference alive for the audio workers.
// It survives rotation and Activity recreation and is owned for the process lifetime.
static APPLICATION: OnceLock<GlobalRef> = OnceLock::new();
static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();

pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    if APPLICATION.get().is_some() {
        return Ok(());
    }
    let context = tao::platform::android::prelude::main_android_context()
        .ok_or("Android activity is not ready")?;
    // SAFETY: Tao owns a live JVM and Activity global reference during startup.
    let vm = unsafe { JavaVM::from_raw(context.java_vm.cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { jni::objects::JObject::from_raw(context.context_jobject.cast()) };
    let application = env.call_method(&activity, "getApplicationContext", "()Landroid/content/Context;", &[])?.l()?;
    let global = env.new_global_ref(application)?;
    drop(env);
    let pointer = global.as_obj().as_raw().cast();
    APPLICATION.set(global).map_err(|_| "Android audio was already initialized")?;
    JAVA_VM.set(vm).map_err(|_| "Android JVM was already initialized")?;
    // SAFETY: called on startup before any CPAL worker; OnceLock guards reentry.
    // The JVM and the Application global reference both outlive all audio workers.
    unsafe { ndk_context::initialize_android_context(context.java_vm, pointer); }
    Ok(())
}

pub fn with_application<T>(
    callback: impl FnOnce(&mut JNIEnv<'_>, &JObject<'_>) -> jni::errors::Result<T>,
) -> Result<T, String> {
    let vm = JAVA_VM.get().ok_or("Android JVM is not initialized")?;
    let application = APPLICATION.get().ok_or("Android application is not initialized")?;
    let mut env = vm.attach_current_thread().map_err(|error| error.to_string())?;
    callback(&mut env, application.as_obj()).map_err(|error| error.to_string())
}
