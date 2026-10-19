// SPDX-License-Identifier: MPL-2.0
use super::*;
use std::io::Write;

fn binary(encrypted: bool) -> Vec<u8> {
    [
        0xfeedfaceu32,
        12,
        9,
        2,
        1,
        20,
        0,
        0x21,
        20,
        0,
        0,
        u32::from(encrypted),
    ]
    .iter()
    .flat_map(|word| word.to_le_bytes())
    .collect()
}

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(*name, zip::write::FileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

const PLIST: &[u8] = br#"<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Test</string>
<key>CFBundleIdentifier</key><string>org.example.test</string>
</dict></plist>"#;

#[test]
fn imports_minimal_arm_ipa() {
    let bytes = archive(&[
        ("Payload/Test.app/Info.plist", PLIST),
        ("Payload/Test.app/Test", &binary(false)),
    ]);
    assert_eq!(inspect_ipa(&bytes).unwrap()["bundleId"], "org.example.test");
}

#[test]
fn rejects_encrypted_executable() {
    assert!(validate_executable(&binary(true))
        .unwrap_err()
        .contains("Encrypted"));
}

#[test]
fn rejects_traversal_and_duplicates() {
    for entries in [
        vec![("../bad", &b""[..])],
        vec![("same", &b""[..]), ("same", &b""[..])],
    ] {
        assert!(inspect_ipa(&archive(&entries))
            .unwrap_err()
            .contains("Unsafe or duplicate"));
    }
}

#[test]
fn rejects_bad_paths() {
    for path in ["", "/a", "a/../b", "a/./b", "a//b", "C:/x", "a\\b", "a\0b"] {
        assert!(!safe_path(path), "{path:?}");
    }
    assert!(safe_path("Payload/Test.app/"));
}

#[test]
fn rejects_truncated_and_wrong_architecture() {
    let bytes = binary(false);
    for end in 0..bytes.len() {
        assert!(validate_executable(&bytes[..end]).is_err());
    }
    let mut bytes = bytes;
    bytes[4..8].copy_from_slice(&0x0100000cu32.to_le_bytes());
    assert!(validate_executable(&bytes).is_err());
}

#[test]
fn selects_arm_from_universal_executable() {
    let arm = binary(false);
    let mut fat: Vec<u8> = [0xcafebabeu32, 1, 12, 9, 28, arm.len() as u32, 0]
        .iter()
        .flat_map(|word| word.to_be_bytes())
        .collect();
    fat.extend(arm);
    validate_executable(&fat).unwrap();
    fat[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(validate_executable(&fat).is_err());
}

#[test]
fn rejects_non_zip_and_missing_manifest() {
    assert!(inspect_ipa(b"not a zip").is_err());
    assert!(inspect_ipa(&archive(&[("readme", b"hello")])).is_err());
}
