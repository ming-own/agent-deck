//! macOS asks this gate before any application termination, including Dock Quit.
//! GPUI's on_app_quit runs too late to veto and has a 200 ms shutdown deadline.
use std::cell::RefCell;

type Gate = Box<dyn FnMut() -> bool>;
thread_local! { static GATE: RefCell<Option<Gate>> = const { RefCell::new(None) }; }

fn decision() -> usize {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        GATE.with(|gate| usize::from(gate.borrow_mut().as_mut().is_some_and(|check| check())))
    }))
    .unwrap_or(0)
}

#[cfg(target_os = "macos")]
pub fn install(check: impl FnMut() -> bool + 'static) -> Result<(), &'static str> {
    use objc2::{
        MainThreadMarker, class, msg_send,
        runtime::{AnyObject, Imp, Sel},
        sel,
    };
    use std::{ffi::CString, ptr};
    MainThreadMarker::new().ok_or("Termination guard must be installed on the main thread")?;
    unsafe extern "C-unwind" fn should_terminate(
        _: *mut AnyObject,
        _: Sel,
        _: *mut AnyObject,
    ) -> usize {
        decision()
    }
    // The pinned GPUI delegate does not implement applicationShouldTerminate:.
    // Add only the missing method; never replace a future upstream implementation.
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![app, delegate];
        let delegate = delegate.as_ref().ok_or("Missing application delegate")?;
        let class = delegate.class();
        let selector = sel!(applicationShouldTerminate:);
        if class.instance_method(selector).is_some() {
            return Err("GPUI already owns the termination gate; adapt before upgrading");
        }
        let encoding = CString::new(format!("{}@:@", <usize as objc2::Encode>::ENCODING)).unwrap();
        // This exact C ABI is NSUInteger (id, SEL, NSApplication *). Objective-C
        // retains the registered function for the process lifetime.
        let implementation: Imp = std::mem::transmute::<
            unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
            Imp,
        >(should_terminate);
        if !objc2::ffi::class_addMethod(
            ptr::from_ref(class).cast_mut(),
            selector,
            implementation,
            encoding.as_ptr(),
        )
        .as_bool()
        {
            return Err("Could not install application termination guard");
        }
    }
    GATE.with(|gate| *gate.borrow_mut() = Some(Box::new(check)));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_: impl FnMut() -> bool + 'static) -> Result<(), &'static str> {
    Err("The native preview currently supports macOS only")
}

#[cfg(test)]
mod tests {
    use super::{GATE, decision};
    #[test]
    fn native_quit_is_cancelled_until_changes_are_saved_or_explicitly_discarded() {
        GATE.with(|gate| *gate.borrow_mut() = Some(Box::new(|| false)));
        assert_eq!(decision(), 0); // NSTerminateCancel
        GATE.with(|gate| *gate.borrow_mut() = Some(Box::new(|| true)));
        assert_eq!(decision(), 1); // NSTerminateNow
        GATE.with(|gate| *gate.borrow_mut() = Some(Box::new(|| panic!("failed to check drafts"))));
        assert_eq!(decision(), 0); // No panic may escape into Objective-C.
        GATE.with(|gate| *gate.borrow_mut() = None);
    }
}
