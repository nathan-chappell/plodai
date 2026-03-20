# The Theoretical Justification of Neural Networks

### 1. On Theoretical Justification

"This is computer science, so the proofs aren't unimportant."
- My Analysis Professor

When I started studying neural networks, one of my first questions was: why should I study neural networks at all?  What makes them worthy of study?  What I was searching for is what I call a "theoretical justification" for studying and attempting to create neural networks.  Well, I found two theorems that answered this question for me satisfactorily.  I'll explain the theorems, since they are interesting in their own right and provide useful context for the rest of the story, but it is really the research surrounding them that makes the whole thing start to feel alive.

This post is meant to stay on the technical side of that story.  I am not going to define Turing machines rigorously or turn this into a textbook chapter.  I just want to show why some very classical theoretical results make neural networks worth taking seriously, and why Pollack's old experiments still feel so striking.

### 2. Universal Approximation

In order to ask this question and even know what an answer might look like, we need a few definitions.  We'll consider the set of continuous functions on the interval `[0,1]`, and refer to it simply as `C([0,1])`.  This is already a very versatile set of functions, but there are still far too many of them.  We could never physically realize a machine that computes an arbitrary continuous function directly; there are simply too many.  So what is useful is a smaller, more tangible class of functions that can stand in for `C([0,1])`.  One familiar example is the set of polynomial functions.  Some beautiful results from undergraduate analysis lead to the conclusion that linear combinations of polynomials can approximate any function from `C([0,1])` arbitrarily well.

To make that phrase precise, we need a notion of distance between functions.  Given two continuous functions `f` and `g`, we measure how far apart they are by looking for the single largest gap between them anywhere on the interval.  In symbols this is the supremum distance: `d(f,g) = sup {|f(x) - g(x)| : x in [0,1]}`.

Next, we say a set of functions `F` approximates `C([0,1])` arbitrarily well if, for any error tolerance `e > 0` and any target function `g` in `C([0,1])`, we can find a function `f` in `F` such that `d(f,g) < e`.  In plain English: no matter how demanding we are, we can still choose a function from `F` that never strays more than `e` away from `g`.

So it becomes a very desirable property of an easily computable class of functions that it can universally approximate the continuous functions on its domain.

This is the first shape of the answer I was looking for.  If a class of models can, in a mathematically precise sense, get arbitrarily close to any continuous target in a broad family, then it is not just a gimmick.  It means we are looking at a flexible representational scheme with real expressive power.

Back to neural networks, first we observe that most neural networks are parameterized, and are hence part of a naturally defined class of neural networks: the class obtained by letting the parameters vary.  It is natural to then ask whether some such class of functions uniformly approximates `C([0,1])`.  It turns out that the most interesting part of the very simple architectures needed to answer this question are the activation functions, and there were a number of theorems proving that very general and simple classes of neural networks were in fact universal.  The first, sort of classic paper that gets referred to is [Cybenko's theorem](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf), though there are simpler and more illustrative proofs for narrower classes of activations.

The picture to keep in mind is not mystical at all.  It is just a family of simple parameterized curves getting better and better at hugging some more interesting target curve.  You vary the parameters, the shape changes, and with enough flexibility the model can press itself surprisingly close to what you wanted.  That basic approximation story is the first reason I came to think neural networks deserve to be taken seriously.

![A small ReLU MLP learning sin(8πx) on [0,1], with selected checkpoints above and loss below.](/blog-assets/theoretical-justification-of-neural-networks/mlp-sine-story.svg)

*Figure caption: the extra late checkpoint is chosen automatically from the measured loss history.  Around that spike, the model briefly gets worse before settling into a much better long-run fit.  Read loosely, the picture is that the network is not just refining amplitudes pointwise; it appears to be reallocating capacity so that one ReLU region can slide toward the neglected leftmost oscillation.  That is why the short-term loss increase matters: it marks a structural reorganization that the final fit benefits from.*

### 3. Turing Completeness and Where the Infinity Hides

Similar considerations can be made for recurrent neural networks (RNNs), but now we are after something stronger.  Rather than approximating some target class of functions, we want Turing completeness.  Glibly, that means the system can in principle carry out any computation a normal programming language can.  In other words, we want to know whether RNNs are really general-purpose problem-solving machines.

This is a very different kind of claim from universal approximation.  Universal approximation says the model class is expressive over a large family of functions.  Turing completeness says something like: this is not merely a clever interpolator.  In principle, it can implement open-ended symbolic procedures.

One thing that started bothering me, in a good way, is that Turing-complete systems always seem to hide an infinity somewhere.  A Turing machine has an infinite tape.  A register machine gets to use arbitrarily large integers.  The lambda calculus allows arbitrarily long reductions.  So where does the infinity go in an RNN?

In the end, it turns out that they are Turing complete - see [Siegelmann and Sontag](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf) for a good technical proof.  And the answer to the "where did the infinity go?" question is: into precision.  The symbolic structure is packed into a bounded region of state space, but doing that requires arbitrarily fine distinctions between nearby points.  The infinity has not vanished.  It has been hidden in the precision needed to represent and manipulate the state.[^precision]

That observation helped a lot of later material click into place for me.  If the power of the system is partly hiding in fine geometric structure, then looking at state space is not a cute visualization trick.  It is a way of peeking at where the computation actually lives.

![A two-stack Cantor-dust encoding of a tape, with a longer binary counting sweep through the compressed state space.](/blog-assets/theoretical-justification-of-neural-networks/stack-cantor-dust-story.svg)

*Figure caption: the tape is represented as two stacks, with the head sitting at the front of the right stack, so every write, carry, and return sweep becomes a deterministic move in Cantor coordinates.  The violent up-and-down motion is not decoration: it comes from the head moving back and forth across the tape while the local tape contents change underneath the same control pattern.  The lower lag-distance strip makes that visible in a second way by showing a broad mix of short and long displacements rather than one tidy movement scale.  That does not prove chaos in a formal dynamical-systems sense, but it does make Pollack's language about fractal and chaotic dynamics feel concrete: a deterministic process moving through a self-similar state space can still exhibit irregular, multi-scale motion.*

### 4. Pollack, Bifurcations, and Fractal Hidden States

But before that proof was nailed down, there was already fascinating work pointing in the same direction.  Pollack's [The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers) is the paper that really makes the story feel alive.  He traced out the trajectories of hidden states in recurrent nets as they learned formal languages, and found abrupt qualitative changes in behavior: networks that had only managed short strings would suddenly begin handling much longer ones, including strings beyond the training range.  He treated these as "aha moments," which is exactly the right phrase.

This is also the point where the technical discussion becomes genuinely fun.  We are no longer just proving an abstract capability theorem.  We are watching a learning system pass through qualitative changes, and the geometry of those changes starts to matter.

That connection between recurrent nets and discrete dynamical systems exhibiting chaotic behavior is magnificent. You can say that AI gets some of its power from chaos, and that is not just poetry.  Pollack was not just reporting better accuracy; he was noticing that the state-space trajectories themselves were beginning to take on fractal structure.

That is also where the "chaos" starts to become more than a metaphor: it is the system's ability to move through that intricate structure in a meaningful way.  The appeal of Pollack's paper is that he does not merely borrow language from dynamics.  He treats the network as a dynamical system and then finds evidence that the dynamics really are doing computational work.

What is so striking is that Pollack really does say the strong version. In the abstract, he writes that "a small weight adjustment causes a 'bifurcation' in the limit behavior of the network" and that this phase transition corresponds to the onset of generalization to "arbitrary-length strings." He also says the architecture appears capable of generating nonregular languages by exploiting "fractal and chaotic dynamics." Later he makes the wonderfully blunt remark that "a discrete dynamical system is just an iterative computation." And the paper does not leave the idea at the level of metaphor: when discussing parenthesis balancing, he says it is mathematically possible to embed an "infinite state machine" in a dynamical recognizer, with a state space built from fractal self-similarity. That is exactly the kind of claim that made this line of thought hard for me to forget.

For this pass I stopped trying to force the RNN into a flashy visual and treated it more like a small research note.  The runtime architecture is still a small `torch.RNN` with `tanh` units, `2` layers, and width `4`, trained on the ordinary balanced-parentheses language.  The training story stays deliberately punctuated: first the network sees only the shortest balanced-parentheses strings, up through length eight, along with a small amount of random length-twenty data; then it is hit with the counterexamples that make the cheap heuristic break.

The important thing is that I did not redesign the trainer.  The phases are the existing phases.  What changed is the reporting.  Instead of dumping every curve or every hidden-state picture into one image, I now use a small held-out watchlist of longer probes for the named story, add a thin held-out background field for context, and then ask whether the counterexamples really do change in a narrower window than the ordinary probes.

![Overlaid hidden-state traces and a boundary-focused bifurcation field along phased torch.RNN training checkpoints.](/blog-assets/theoretical-justification-of-neural-networks/rnn-training-story.svg)

*Figure caption: the top row shows held-out hidden-state clouds at the ends of the two training phases, with the projected acceptance ball in green and the three watched probes drawn as thin trajectories with explicit starts and finishes.  Those probes are chosen to play different roles: an ordinary balanced control, a one-close off-by-one string that ought to be rejected, and an almost-valid repair case whose fate changes only when the counterexamples arrive.  The lower panel follows those same three strings across checkpoints on the full probability range, but with extra visual resolution near `p(valid)=0.5`, where the decision actually changes.  The thin background field is there to keep the picture honest: if the named curves look dramatic, they still have to sit inside the measured behavior of the larger held-out probe set.*

[Summary Table CSV](/blog-assets/theoretical-justification-of-neural-networks/rnn-transition-summary.csv) · [Assessment Notes](/blog-assets/theoretical-justification-of-neural-networks/rnn-transition-assessment.md)

I also save the supporting metrics separately: a compact probe summary CSV, checkpoint-by-checkpoint family metrics, full probe trajectories, and a short assessment of whether the transition looks abrupt, gradual, or absent.  That matters here because the Pollack-style language of bifurcation is interesting only if the measured data really support it.  If the transition is weak or spread out, the honest thing is to say so.

A compact way to describe the machine is this.  The acceptance rule is uniform across all checkpoints: accept exactly when the final hidden state lands inside a fixed-radius neighborhood around an anchor point in hidden-state space.  After phase 1, many strings are still organized by a cheap short-range heuristic.  After phase 2, the interesting question is not whether a pretty picture can be drawn, but whether a small number of real counterexample probes move more sharply than the ordinary ones.

### 5. Wrap-Up

So for me, that is the theoretical justification.  Feedforward networks are already broad enough to approximate an enormous class of functions.  Recurrent networks go further and cross into general computation.  And once you notice that the price of that power is hidden structure, precision, and opacity, the conversation naturally starts drifting away from engineering and toward dynamics, complexity, and interpretation.

That is enough, I think, to justify real attention from anyone who likes theory.  Even if one turned out to dislike most present-day AI products, these are still beautiful and slightly unsettling mathematical objects.  The more philosophical story begins when we ask what it means to live with them.  But that is really a second post.

---
References:

- Classic paper on universal approximation: [Cybenko - Approximation by Superpositions of a Sigmoidal Function](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf)
- Turing-completeness result for recurrent nets: [Siegelmann Sontag 1992 - On The Computational Power Of Neural Nets](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf)
- Pollack on dynamical recognizers, phase transitions, and fractal state spaces: [Pollack 1991 - The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers)

[^precision]: A convenient model is to map a binary stack `a = (a_1, a_2, ...)`, with `a_i in {0,1}`, to the real number `q(a) = sum_{i=1}^{infty} (2a_i + 1) 4^{-i}`.  Using two stacks gives a point `(q(a), q(b)) in [0,1]^2`, and the odd base-4 digits force the image into a Cantor-dust subset of the square.  The rendered picture in the article only shows a finite depth of that construction, but the Turing-completeness story needs the same self-similar nesting to continue indefinitely, which is exactly where the infinite-precision requirement comes from.
