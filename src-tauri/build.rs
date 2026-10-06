fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/mac_fn_listener.m");
        cc::Build::new()
            .file("src/mac_fn_listener.m")
            .compile("mac_fn_listener");
        println!("cargo:rustc-link-lib=framework=Cocoa");
    }

    tauri_build::build()
}
