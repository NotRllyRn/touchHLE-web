// SPDX-License-Identifier: MPL-2.0
//! Sparse-memory feasibility adapter, not yet connected to the HLE or CPU.
//! A mapping owns stable, 8-byte-aligned storage. Slices may cross guest pages
//! within a mapping, but never bridge independently allocated host regions.

use std::collections::BTreeMap;

const PAGE: u64 = 4096;
const ADDRESS_SPACE: u64 = 1 << 32;

struct Region {
    words: Box<[u64]>,
}
impl Region {
    fn bytes(&self) -> &[u8] {
        // All bit patterns are valid bytes; allocation remains owned by self.
        unsafe { std::slice::from_raw_parts(self.words.as_ptr().cast(), self.words.len() * 8) }
    }
    fn bytes_mut(&mut self) -> &mut [u8] {
        unsafe {
            std::slice::from_raw_parts_mut(self.words.as_mut_ptr().cast(), self.words.len() * 8)
        }
    }
}

pub struct GuestMemory {
    regions: BTreeMap<u32, Region>,
    mapped: u64,
    limit: u64,
}

impl GuestMemory {
    pub fn new(limit: u64) -> Self {
        Self {
            regions: BTreeMap::new(),
            mapped: 0,
            limit,
        }
    }

    pub fn mappings(&mut self) -> Vec<(u32, usize, *mut u8)> {
        self.regions
            .iter_mut()
            .map(|(&base, region)| {
                let bytes = region.bytes_mut();
                (base, bytes.len(), bytes.as_mut_ptr())
            })
            .collect()
    }

    pub fn guest_address(&self, pointer: *const u8) -> Option<u32> {
        self.regions.iter().find_map(|(&base, region)| {
            let bytes = region.bytes();
            let offset = (pointer as usize).checked_sub(bytes.as_ptr() as usize)?;
            (offset < bytes.len()).then(|| base + offset as u32)
        })
    }

    pub fn map(&mut self, base: u32, len: u32) -> Result<(), &'static str> {
        let start = u64::from(base);
        let size = u64::from(len);
        let end = start + size;
        if start < PAGE || size == 0 || start % PAGE != 0 || size % PAGE != 0 {
            return Err("Mapping must be page aligned and exclude the null page");
        }
        if end > ADDRESS_SPACE || self.mapped + size > self.limit {
            return Err("Mapping exceeds address space or memory budget");
        }
        if let Some((&previous, region)) = self.regions.range(..=base).next_back() {
            if u64::from(previous) + region.bytes().len() as u64 > start {
                return Err("Overlapping mapping");
            }
        }
        if let Some((&next, _)) = self.regions.range(base..).next() {
            if u64::from(next) < end {
                return Err("Overlapping mapping");
            }
        }
        let mut words = Vec::new();
        words
            .try_reserve_exact(len as usize / 8)
            .map_err(|_| "Host allocation failed")?;
        words.resize(len as usize / 8, 0);
        self.regions.insert(
            base,
            Region {
                words: words.into_boxed_slice(),
            },
        );
        self.mapped += size;
        Ok(())
    }

    fn location(&self, address: u32, len: usize) -> Result<(u32, usize), &'static str> {
        if u64::from(address)
            .checked_add(len as u64)
            .is_none_or(|end| end > ADDRESS_SPACE)
        {
            return Err("Guest address overflow");
        }
        let (&base, region) = self
            .regions
            .range(..=address)
            .next_back()
            .ok_or("Unmapped guest address")?;
        let offset = (address - base) as usize;
        // Even a zero-length pointer must refer to an actual mapped byte.
        if offset >= region.bytes().len() || len > region.bytes().len() - offset {
            return Err("Slice crosses mapping boundary");
        }
        Ok((base, offset))
    }

    pub fn slice(&self, address: u32, len: usize) -> Result<&[u8], &'static str> {
        let (base, offset) = self.location(address, len)?;
        Ok(&self.regions[&base].bytes()[offset..offset + len])
    }

    pub fn slice_mut(&mut self, address: u32, len: usize) -> Result<&mut [u8], &'static str> {
        let (base, offset) = self.location(address, len)?;
        Ok(&mut self.regions.get_mut(&base).unwrap().bytes_mut()[offset..offset + len])
    }
}

/// Run identical boundary checks on native and WASM. No guest assets needed.
pub fn check() -> Result<(), &'static str> {
    let mut mem = GuestMemory::new(4 * PAGE);
    mem.map(0x1000, 8192)?;
    mem.map(0xffff_f000, 4096)?;
    let pointer = mem.slice(0x1000, 1)?.as_ptr();
    mem.map(0x4000, 4096)?;
    if mem.slice(0x1000, 1)?.as_ptr() != pointer || pointer as usize % 8 != 0 {
        return Err("Mapping moved or is unaligned");
    }
    mem.slice_mut(0x1ffe, 4)?.copy_from_slice(&[1, 2, 3, 4]);
    mem.slice_mut(0xffff_fffc, 4)?
        .copy_from_slice(&[5, 6, 7, 8]);
    if mem.slice(0x1ffe, 4)? != [1, 2, 3, 4] || mem.slice(0xffff_fffc, 4)? != [5, 6, 7, 8] {
        return Err("Cross-page/high-address roundtrip failed");
    }
    for (address, len) in [(0, 0), (0x3000, 1), (0x2fff, 2), (u32::MAX, 2)] {
        if mem.slice(address, len).is_ok() {
            return Err("Invalid slice accepted");
        }
    }
    for (base, len) in [
        (0, 4096),
        (0x1000, 4096),
        (0x5000, 4096),
        (0xffff_f000, 8192),
    ] {
        if mem.map(base, len).is_ok() {
            return Err("Invalid mapping accepted");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparse_memory_boundaries_and_stable_pointers() {
        check().unwrap();
    }

    #[test]
    fn adjacent_regions_do_not_form_a_host_slice() {
        let mut mem = GuestMemory::new(16384);
        mem.map(0x1000, 4096).unwrap();
        mem.map(0x2000, 4096).unwrap();
        assert!(mem.slice(0x1fff, 2).is_err());
        assert!(mem.map(0x1000, 8192).is_err());
        assert!(mem.map(0x4001, 4096).is_err());
        assert!(mem.map(0x4000, 1).is_err());
        assert!(mem.map(0x4000, 0).is_err());
        assert!(mem.slice(0x1000, usize::MAX).is_err());
        assert_eq!(mem.slice(0x2000, 16).unwrap(), [0; 16]);
    }
}
