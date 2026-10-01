/// Smoothly compress FFT magnitudes without flattening loud mobile audio at 1.
/// A desktop-compatible hard ceiling erased beat variations above magnitude 32.
pub fn mobile_magnitude(magnitude: f32) -> f32 {
    if !magnitude.is_finite() || magnitude <= 0.0 {
        return 0.0;
    }
    let soft = magnitude / (32.0 + magnitude);
    (1.0 + soft * 9.0).ln() / 10.0_f32.ln()
}

#[cfg(test)]
mod tests {
    use super::mobile_magnitude;

    #[test]
    fn loud_hits_keep_their_dynamic_range() {
        // All of these were exactly 1 before the frontend even saw the spectrum.
        let levels = [32.0, 48.0, 64.0, 96.0, 128.0, 256.0, 512.0];
        let mut previous = 0.0;
        for level in levels {
            let value = mobile_magnitude(level);
            assert!(value > previous && value < 1.0, "{level}: {value}");
            previous = value;
        }
        assert!(mobile_magnitude(128.0) - mobile_magnitude(64.0) > 0.04);
    }

    #[test]
    fn silence_and_invalid_samples_are_bounded() {
        for sample in [0.0, -1.0, f32::NAN, f32::INFINITY] {
            assert_eq!(mobile_magnitude(sample), 0.0);
        }
        for sample in [0.001, 0.1, 1.0, 32.0, 1000.0, f32::MAX] {
            assert!((0.0..=1.0).contains(&mobile_magnitude(sample)));
        }
    }
}
