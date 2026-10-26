/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
//! stdlib's qsort

use crate::abi::{CallFromHost, GuestFunction};
use crate::dyld::{export_c_func, FunctionExports};
use crate::mem::MutPtr;
use crate::Environment;

fn qsort(
    env: &mut Environment,
    base: MutPtr<u8>,
    nitems: u32,
    size: u32,
    compar: GuestFunction, // int (*compar)(const void *, const void*))
) {
    qsort_generic(
        env,
        nitems,
        &mut |env, i, j| {
            let i_ptr = base + i * size;
            let j_ptr = base + j * size;
            compar.call_from_host(env, (i_ptr.cast_const(), j_ptr.cast_const()))
        },
        &mut |env: &mut Environment, mut i: u32, mut j: u32| {
            if i == j {
                return;
            }
            if i > j {
                std::mem::swap(&mut i, &mut j);
            }
            let base_slice = env.mem.bytes_at_mut(base, nitems * size);
            let (_, slice_after_first) = base_slice.split_at_mut((i * size) as usize);
            let offset = (j * size - i * size) as usize;
            let (left, right) = slice_after_first.split_at_mut(offset);
            left[..size as usize].swap_with_slice(&mut right[..size as usize]);
        },
    );
}

pub fn qsort_generic<T, Compare, Swap>(
    user_data: &mut T,
    nitems: u32,
    compar: &mut Compare, // int (*compar)(const void *, const void*))
    swap: &mut Swap,
) where
    Compare: FnMut(&mut T, u32, u32) -> i32,
    Swap: FnMut(&mut T, u32, u32),
{
    if nitems < 2 {
        return;
    }
    // A first-element quicksort pivot makes sorted/duplicate-heavy inputs
    // quadratic. Guest comparator calls are expensive; bound their count and
    // avoid recursive host-stack growth with an in-place heapsort.
    for root in (0..nitems / 2).rev() {
        sift_down(user_data, compar, swap, root, nitems);
    }
    for end in (1..nitems).rev() {
        swap(user_data, 0, end);
        sift_down(user_data, compar, swap, 0, end);
    }
}

fn sift_down<T, Compare, Swap>(
    user_data: &mut T,
    compar: &mut Compare,
    swap: &mut Swap,
    mut root: u32,
    end: u32,
) where
    Compare: FnMut(&mut T, u32, u32) -> i32,
    Swap: FnMut(&mut T, u32, u32),
{
    // Check before doubling to avoid overflow even for very large arrays.
    while root < end / 2 {
        let mut child = root * 2 + 1;
        if child + 1 < end && compar(user_data, child, child + 1) < 0 {
            child += 1;
        }
        if compar(user_data, root, child) >= 0 {
            break;
        }
        swap(user_data, root, child);
        root = child;
    }
}

#[cfg(test)]
mod tests {
    use super::qsort_generic;

    fn check(values: Vec<i32>, length: usize) -> usize {
        let mut expected = values.clone();
        expected[..length].sort_unstable();
        let mut state = (values, 0);
        qsort_generic(
            &mut state,
            length as u32,
            &mut |(values, comparisons), i, j| {
                *comparisons += 1;
                values[i as usize].cmp(&values[j as usize]) as i32
            },
            &mut |(values, _), i, j| values.swap(i as usize, j as usize),
        );
        assert_eq!(state.0, expected);
        state.1
    }

    #[test]
    fn edge_cases_and_subarray_boundary() {
        assert_eq!(check(vec![], 0), 0);
        assert_eq!(check(vec![42], 1), 0);
        check(vec![i32::MAX, i32::MIN, 0, 99, -99], 3);
        check(vec![2, 1], 2);
    }

    #[test]
    fn adversarial_inputs_have_bounded_comparator_calls() {
        let n = 4096;
        for values in [
            (0..n).collect(),
            (0..n).rev().collect(),
            vec![7; n as usize],
            (0..n).map(|i| i % 2).collect(),
            (0..n).map(|i| i.min(n - i)).collect(),
        ] {
            let comparisons = check(values, n as usize);
            assert!(
                comparisons < 3 * n as usize * 12,
                "{comparisons} comparisons"
            );
        }
    }

    #[test]
    fn seeded_random_inputs_preserve_values() {
        let mut seed = 0x12345678u32;
        for length in 0..256 {
            let values = (0..length)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    seed as i32
                })
                .collect();
            check(values, length);
        }
    }
}

pub const FUNCTIONS: FunctionExports = &[export_c_func!(qsort(_, _, _, _))];
