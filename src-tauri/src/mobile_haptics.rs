#[cfg(target_os = "ios")]
unsafe extern "C" { fn lomify_haptic(kind: i32); }

#[tauri::command]
pub fn mobile_haptic(app: tauri::AppHandle, kind: String) {
    #[cfg(target_os = "ios")]
    {
        let kind = i32::from(kind == "light");
        let _ = app.run_on_main_thread(move || unsafe { lomify_haptic(kind) });
    }
    #[cfg(target_os = "android")]
    {
        use jni::objects::{GlobalRef, JValue};
        use std::sync::OnceLock;
        static ACTIVITY_CLASS: OnceLock<GlobalRef> = OnceLock::new();
        let kind = i32::from(kind == "light");
        let _ = crate::android_audio::with_application(|env, application| {
            if ACTIVITY_CLASS.get().is_none() {
                let loader = env.call_method(application, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
                let name = env.new_string("com.lomify.next.MainActivity")?;
                let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(name.as_ref())])?.l()?;
                let _ = ACTIVITY_CLASS.set(env.new_global_ref(class)?);
            }
            if let Some(class) = ACTIVITY_CLASS.get() {
                env.call_static_method(class, "performHaptic", "(I)V", &[JValue::Int(kind)])?;
            }
            Ok(())
        });
        let _ = app;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = (app, kind);
}
