//! Turns per-window cosines into a live answer. Windows are averaged over the last few seconds,
//! as the mean cosine scored best on real recordings, and an answer is only given when the
//! leader is clearly ahead of the runner-up and has stayed in front. Once a tune is named, a
//! short view of the last few windows notices when a set moves on to the next one.

use std::collections::VecDeque;

/// Windows (one a second) averaged together. Longer is steadily better on the real eval clips
/// (leader right at each second: 8 → 59%, 16 → 67%, 32 → 72%, whole clip → 77%); 30 still lets a
/// set's next tune take over within about half a minute.
pub const HISTORY: usize = 30;
/// Lead of the best tune's mean cosine over the second's. At 30 windows, 0.04 answers on about
/// two-thirds of clips and is right on 85% of those.
pub const MATCH_MARGIN: f64 = 0.04;
pub const MIN_WINDOWS: usize = 3;
pub const STABLE_UPDATES: usize = 2;
/// Popular tunes are heard more often: each tune's mean cosine gains this much per ln(tunebooks + 1)
/// (ml/PIPELINE.md §11).
pub const POPULARITY_WEIGHT: f64 = 0.006;
/// Moving on: after a tune is named, the mean of only the last `SWITCH_WINDOW` windows is watched. When another
/// tune leads it by `SWITCH_MARGIN` for `STABLE_UPDATES` updates, that tune is named and the history is cut to those
/// windows. On labelled sessions the median time to name each tune of a set fell from 19.4 s to 10.2 s with as few
/// wrong names (decode.ts, ml/eval/session_decode.py).
pub const SWITCH_WINDOW: usize = 8;
pub const SWITCH_MARGIN: f64 = MATCH_MARGIN + 0.06;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Listening,
    Unsure,
    Match,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Candidate {
    pub index: usize,
    pub cosine: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub status: Status,
    pub candidates: Vec<Candidate>,
    pub margin: f64,
}

/// Each tune's prior, in cosine units, from how many The Session member tunebooks hold it.
pub fn popularity_prior(tunebooks: &[u32]) -> Vec<f32> {
    tunebooks.iter().map(|&n| (POPULARITY_WEIGHT * (n as f64 + 1.0).ln()) as f32).collect()
}

#[derive(Debug, Default)]
pub struct Decoder {
    windows: VecDeque<Vec<f32>>,
    leaders: VecDeque<Option<usize>>,
    recent_leaders: VecDeque<Option<usize>>,
    /// The tune last answered, which the short view watches for a change.
    named: Option<usize>,
    prior: Option<Vec<f32>>,
}

impl Decoder {
    /// `prior` is added to every tune's mean cosine before ranking ([`popularity_prior`]).
    pub fn new(prior: Option<Vec<f32>>) -> Self {
        Self { prior, ..Self::default() }
    }

    pub fn set_prior(&mut self, prior: Option<Vec<f32>>) {
        self.prior = prior;
    }

    /// The prior-weighted mean of the last `n` windows, its top ten and the leader's margin.
    fn ranked(&self, n: usize) -> (Vec<Candidate>, f64) {
        let mut scores = vec![0.0f32; self.windows[0].len()];
        for window in self.windows.iter().skip(self.windows.len() - n) {
            for (s, &w) in scores.iter_mut().zip(window) {
                *s += w;
            }
        }
        for s in &mut scores {
            *s /= n as f32;
        }
        if let Some(prior) = &self.prior {
            for (s, &p) in scores.iter_mut().zip(prior) {
                *s += p;
            }
        }
        let candidates = top_k(&scores, 10);
        let margin = if candidates.len() > 1 { candidates[0].cosine as f64 - candidates[1].cosine as f64 } else { 0.0 };
        (candidates, margin)
    }

    pub fn push(&mut self, cosines: &[f32]) -> Verdict {
        self.windows.push_back(cosines.to_vec());
        if self.windows.len() > HISTORY {
            self.windows.pop_front();
        }
        if let Some(named) = self.named.filter(|_| self.windows.len() >= SWITCH_WINDOW) {
            let (candidates, margin) = self.ranked(SWITCH_WINDOW);
            let leader = candidates.first().map(|c| c.index);
            self.recent_leaders.push_back(leader);
            if self.recent_leaders.len() > STABLE_UPDATES {
                self.recent_leaders.pop_front();
            }
            let held = self.recent_leaders.len() == STABLE_UPDATES && self.recent_leaders.iter().all(|l| *l == leader);
            if let Some(next) = leader.filter(|&l| l != named && margin >= SWITCH_MARGIN && held) {
                while self.windows.len() > SWITCH_WINDOW {
                    self.windows.pop_front();
                }
                self.leaders = std::iter::repeat_n(Some(next), STABLE_UPDATES).collect();
                self.named = Some(next);
                return Verdict { status: Status::Match, candidates, margin };
            }
        }
        let (candidates, margin) = self.ranked(self.windows.len());
        self.leaders.push_back(candidates.first().map(|c| c.index));
        if self.leaders.len() > STABLE_UPDATES {
            self.leaders.pop_front();
        }
        let stable = self.leaders.len() == STABLE_UPDATES && self.leaders.iter().all(|l| *l == self.leaders[0]);
        let status = if self.windows.len() < MIN_WINDOWS {
            Status::Listening
        } else if margin >= MATCH_MARGIN && stable {
            Status::Match
        } else {
            Status::Unsure
        };
        if status == Status::Match {
            self.named = candidates.first().map(|c| c.index);
        }
        Verdict { status, candidates, margin }
    }

    pub fn reset(&mut self) {
        self.windows.clear();
        self.leaders.clear();
        self.recent_leaders.clear();
        self.named = None;
    }
}

/// The `k` highest values, best first; ties keep the earlier index first.
pub fn top_k(values: &[f32], k: usize) -> Vec<Candidate> {
    let mut best: Vec<Candidate> = Vec::with_capacity(k + 1);
    for (i, &value) in values.iter().enumerate() {
        if best.len() == k && value <= best[k - 1].cosine {
            continue;
        }
        let mut at = if best.len() < k { best.len() } else { k - 1 };
        while at > 0 && best[at - 1].cosine < value {
            at -= 1;
        }
        best.insert(at, Candidate { index: i, cosine: value });
        best.truncate(k);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_the_highest_cosines_first() {
        let ranked: Vec<usize> = top_k(&[0.1, 0.5, 0.3, 0.9, 0.2], 3).iter().map(|c| c.index).collect();
        assert_eq!(ranked, [3, 1, 2]);
    }

    #[test]
    fn answers_only_once_a_clear_leader_has_held() {
        let mut decoder = Decoder::new(None);
        let window = [0.1, 0.4, 0.2];
        assert_eq!(decoder.push(&window).status, Status::Listening);
        assert_eq!(decoder.push(&window).status, Status::Listening);
        let verdict = decoder.push(&window);
        assert_eq!(verdict.status, Status::Match);
        assert_eq!(verdict.candidates.iter().map(|c| c.index).collect::<Vec<_>>(), [1, 2, 0]);
        assert_eq!(decoder.push(&[0.3, 0.31, 0.3]).status, Status::Match);
        decoder.reset();
        assert_eq!(decoder.push(&window).status, Status::Listening);
    }

    #[test]
    fn keeps_each_window_when_the_caller_reuses_its_buffer() {
        let mut decoder = Decoder::new(None);
        let mut buffer = [0.0f32; 3];
        for _ in 0..3 {
            buffer.copy_from_slice(&[0.1, 0.5, 0.2]);
            decoder.push(&buffer);
        }
        buffer.copy_from_slice(&[0.6, 0.0, 0.2]);
        // Three windows for tune 1 and one for tune 0: tune 1 still leads on the mean.
        assert_eq!(decoder.push(&buffer).candidates[0].index, 1);
    }

    fn tune(leader: usize) -> [f32; 3] {
        let mut w = [0.3f32; 3];
        w[leader] = 0.5;
        w
    }

    #[test]
    fn moves_on_to_a_sets_next_tune_within_the_short_view() {
        let mut decoder = Decoder::new(None);
        for _ in 0..HISTORY {
            decoder.push(&tune(0));
        }
        let mut seconds = 0;
        let mut verdict = decoder.push(&tune(2));
        while !(verdict.status == Status::Match && verdict.candidates[0].index == 2) && seconds < HISTORY {
            verdict = decoder.push(&tune(2));
            seconds += 1;
        }
        assert!(seconds <= SWITCH_WINDOW, "took {seconds} s");
        assert_eq!(decoder.push(&tune(2)).candidates[0].index, 2);
    }

    #[test]
    fn does_not_switch_on_a_few_odd_windows() {
        let mut decoder = Decoder::new(None);
        for _ in 0..HISTORY {
            decoder.push(&tune(0));
        }
        for _ in 0..3 {
            decoder.push(&tune(2));
        }
        assert_eq!(decoder.push(&tune(0)).candidates[0].index, 0);
    }

    #[test]
    fn lets_a_much_more_popular_tune_win_a_near_tie() {
        let window = [0.41, 0.4, 0.1];
        assert_eq!(Decoder::new(None).push(&window).candidates[0].index, 0);
        let mut decoder = Decoder::new(Some(popularity_prior(&[0, 5000, 0])));
        assert_eq!(decoder.push(&window).candidates[0].index, 1);
    }
}
