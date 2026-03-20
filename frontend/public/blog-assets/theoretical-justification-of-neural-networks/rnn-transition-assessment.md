# Transition Assessment: gradual

## Measured Facts
- The representative counterexample O13 changes by -0.037 in p(valid), with its steepest checkpoint-to-checkpoint move ending at epoch 50.
- The ordinary probe V36 changes by +0.195 overall and has total variation 0.534.
- The near-boundary probe P07 comes within 0.061 of the decision boundary and flips at epochs [].
- Across the whole probe pool, mean counterexample step size is 0.278 versus 0.192 for ordinary probes.

## Interpretation
- A bifurcation-like interpretation is warranted only if counterexample change is concentrated into a narrow checkpoint window and clearly exceeds the ordinary-family background drift.
- On these measurements the transition is classified as gradual.
- The classification is driven by the concentration of counterexample changes and their separation from ordinary-probe movement, not by the appearance of the plot alone.

## Uncertainty
- The checkpoints are sparse publication checkpoints rather than every optimization step, so any narrow event could be broader or sharper between samples.
- The representative probes are selected by explicit metrics, but a different probe pool or seed could shift which examples look most illustrative.
- This is evidence for a phase-specific learning transition, not a proof of a dynamical bifurcation in the formal systems sense.
