//! Exact note lengths, as fractions of a whole note.

use std::ops::{Add, Mul};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Frac {
    pub num: i64,
    pub den: i64,
}

impl Frac {
    pub const ZERO: Frac = Frac { num: 0, den: 1 };

    pub fn new(num: i64, den: i64) -> Frac {
        if den == 0 {
            return Frac::ZERO;
        }
        let g = gcd(num.abs(), den.abs()).max(1);
        let sign = if den < 0 { -1 } else { 1 };
        Frac { num: sign * num / g, den: sign * den / g }
    }

    pub fn f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }
}

impl Add for Frac {
    type Output = Frac;
    fn add(self, other: Frac) -> Frac {
        Frac::new(self.num * other.den + other.num * self.den, self.den * other.den)
    }
}

impl Mul for Frac {
    type Output = Frac;
    fn mul(self, other: Frac) -> Frac {
        Frac::new(self.num * other.num, self.den * other.den)
    }
}

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a } else { gcd(b, a % b) }
}
