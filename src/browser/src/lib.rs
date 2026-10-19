// SPDX-License-Identifier: MPL-2.0
//! Browser-safe IPA preflight, independent of native graphics/CPU dependencies.
//! This does not load or execute a guest application.

use std::collections::HashSet;
use std::io::{Cursor, Read};

pub const MAX_IPA_BYTES: usize = 256 * 1024 * 1024;
const MAX_MEMBER_BYTES: u64 = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 512 * 1024 * 1024;

fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', ':', '\0'])
        && path
            .trim_end_matches('/')
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn read_member(
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let file = zip.by_name(name).map_err(|e| e.to_string())?;
    if file.size() > limit {
        return Err(format!("Archive member exceeds limit: {name}"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("Expanded member exceeds limit: {name}"));
    }
    Ok(bytes)
}

fn word(bytes: &[u8], at: usize, big_endian: bool) -> Result<u32, String> {
    let raw = bytes
        .get(at..at.checked_add(4).ok_or("Offset overflow")?)
        .ok_or("Truncated executable")?;
    let raw: [u8; 4] = raw.try_into().unwrap();
    Ok(if big_endian {
        u32::from_be_bytes(raw)
    } else {
        u32::from_le_bytes(raw)
    })
}

fn arm_slice(bytes: &[u8]) -> Result<&[u8], String> {
    if word(bytes, 0, true)? != 0xcafebabe {
        return Ok(bytes);
    }
    let count = word(bytes, 4, true)? as usize;
    if count == 0 || count > 32 || bytes.len() < 8 + count * 20 {
        return Err("Invalid universal executable header".into());
    }
    for i in 0..count {
        let at = 8 + i * 20;
        if word(bytes, at, true)? == 12 {
            let offset = word(bytes, at + 8, true)? as usize;
            let size = word(bytes, at + 12, true)? as usize;
            let end = offset.checked_add(size).ok_or("Slice overflow")?;
            if offset < 8 + count * 20 {
                return Err("Executable slice overlaps header".into());
            }
            return bytes.get(offset..end).ok_or("Truncated ARM slice".into());
        }
    }
    Err("No 32-bit ARM slice (ARM64-only IPAs are unsupported)".into())
}

fn validate_executable(bytes: &[u8]) -> Result<(), String> {
    let bytes = arm_slice(bytes)?;
    if word(bytes, 0, false)? != 0xfeedface || word(bytes, 4, false)? != 12 {
        return Err("Expected a little-endian 32-bit ARM Mach-O executable".into());
    }
    if word(bytes, 12, false)? != 2 {
        return Err("Mach-O is not an application executable".into());
    }
    let count = word(bytes, 16, false)? as usize;
    let size = word(bytes, 20, false)? as usize;
    let end = 28usize.checked_add(size).ok_or("Command size overflow")?;
    if end > bytes.len() || count > size / 8 {
        return Err("Invalid Mach-O command bounds".into());
    }
    let mut at = 28;
    for _ in 0..count {
        if at + 8 > end {
            return Err("Truncated Mach-O command".into());
        }
        let command = word(bytes, at, false)?;
        let size = word(bytes, at + 4, false)? as usize;
        let next = at.checked_add(size).ok_or("Command overflow")?;
        if size < 8 || size % 4 != 0 || next > end {
            return Err("Invalid Mach-O command size".into());
        }
        if command == 0x21 {
            if size < 20 {
                return Err("Truncated encryption command".into());
            }
            if word(bytes, at + 16, false)? != 0 {
                return Err("Encrypted executable: an unencrypted IPA is required".into());
            }
        }
        at = next;
    }
    if at != end {
        return Err("Mach-O command sizes do not match header".into());
    }
    Ok(())
}

/// Validate archive structure and identify an eligible executable. Eligibility
/// is not compatibility: the actual HLE loader must validate/load segments.
pub fn inspect_ipa(bytes: &[u8]) -> Result<serde_json::Value, String> {
    if bytes.len() > MAX_IPA_BYTES {
        return Err("IPA exceeds the 256 MiB browser import limit".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if zip.len() > 20_000 {
        return Err("Too many archive entries".into());
    }
    let mut names = HashSet::new();
    let mut expanded = 0u64;
    let mut manifests = Vec::new();
    for i in 0..zip.len() {
        let file = zip.by_index(i).map_err(|e| e.to_string())?;
        let path = file.name();
        if !safe_path(path) || !names.insert(path.to_owned()) {
            return Err(format!("Unsafe or duplicate archive path: {path}"));
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Archive symlinks are unsupported".into());
        }
        expanded = expanded
            .checked_add(file.size())
            .ok_or("Archive size overflow")?;
        if file.size() > MAX_MEMBER_BYTES || expanded > MAX_EXPANDED_BYTES {
            return Err("Archive exceeds browser expansion limits".into());
        }
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() == 3
            && parts[0] == "Payload"
            && parts[1].ends_with(".app")
            && parts[2] == "Info.plist"
        {
            manifests.push(path.to_owned());
        }
    }
    if manifests.len() != 1 {
        return Err("Expected exactly one Payload/*.app/Info.plist".into());
    }
    let manifest = &manifests[0];
    let plist =
        plist::Value::from_reader(Cursor::new(read_member(&mut zip, manifest, 1024 * 1024)?))
            .map_err(|e| e.to_string())?;
    let dictionary = plist
        .as_dictionary()
        .ok_or("Info.plist is not a dictionary")?;
    let string = |key| {
        dictionary
            .get(key)
            .and_then(plist::Value::as_string)
            .ok_or_else(|| format!("Missing/string-invalid {key}"))
    };
    let executable = string("CFBundleExecutable")?;
    if !safe_path(executable) || executable.contains('/') {
        return Err("Invalid bundle executable name".into());
    }
    let root = manifest.strip_suffix("Info.plist").unwrap();
    let executable_path = format!("{root}{executable}");
    let binary = read_member(&mut zip, &executable_path, MAX_MEMBER_BYTES)?;
    validate_executable(&binary)?;
    Ok(serde_json::json!({
        "bundleId": string("CFBundleIdentifier")?,
        "name": dictionary.get("CFBundleDisplayName").or_else(|| dictionary.get("CFBundleName"))
            .and_then(plist::Value::as_string).unwrap_or(executable),
        "executable": executable_path,
        "entries": zip.len(), "expandedBytes": expanded,
        "architecture": "ARM32", "status": "validated-not-executed"
    }))
}

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(test)]
mod tests;
