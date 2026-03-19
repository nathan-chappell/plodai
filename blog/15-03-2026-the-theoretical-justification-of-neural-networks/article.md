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

![A small ReLU MLP learning sin(8πx) on [0,1], with selected checkpoints above and loss below.](/blog-assets/theoretical-justification-of-neural-networks/mlp-sine-story.png)

*Story of the figure: at epoch 0 the network is basically just a line.  By epoch 30 it has started to notice that the target alternates, but it is still missing the rhythm.  By epoch 200 it has learned most of the peaks and troughs, and by the end it is close enough that the universal-approximation idea stops feeling abstract and starts feeling mechanical.*

### 3. Turing Completeness and Where the Infinity Hides

Similar considerations can be made for recurrent neural networks (RNNs), but now we are after something stronger.  Rather than approximating some target class of functions, we want Turing completeness.  Glibly, that means the system can in principle carry out any computation a normal programming language can.  In other words, we want to know whether RNNs are really general-purpose problem-solving machines.

This is a very different kind of claim from universal approximation.  Universal approximation says the model class is expressive over a large family of functions.  Turing completeness says something like: this is not merely a clever interpolator.  In principle, it can implement open-ended symbolic procedures.

One thing that started bothering me, in a good way, is that Turing-complete systems always seem to hide an infinity somewhere.  A Turing machine has an infinite tape.  A register machine gets to use arbitrarily large integers.  The lambda calculus allows arbitrarily long reductions.  So where does the infinity go in an RNN?

In the end, it turns out that they are Turing complete - see [Siegelmann and Sontag](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf) for a good technical proof.  And the answer to the "where did the infinity go?" question is: into precision.  The symbolic structure is packed into a bounded region of state space, but doing that requires arbitrarily fine distinctions between nearby points.  The infinity has not vanished.  It has been hidden in the precision needed to represent and manipulate the state.[^precision]

That observation helped a lot of later material click into place for me.  If the power of the system is partly hiding in fine geometric structure, then looking at state space is not a cute visualization trick.  It is a way of peeking at where the computation actually lives.

![A two-stack Cantor-dust encoding of a tape, with one curated path through the compressed state space.](/blog-assets/theoretical-justification-of-neural-networks/stack-cantor-dust-story.png)

*Story of the figure: the tape is split into two binary stacks, one for the cells to the left of the head and one for the head plus everything to its right.  Each stack is encoded by odd base-4 digits, so a push descends into a smaller copied cell of the Cantor dust while a pop jumps back across scale.  The numbered path is not meant to be a deep computation in its own right; it is a deliberately chosen sequence of writes and head moves whose only job is to make the precision story visible.*

[Interactive Cantor-dust story](/blog-assets/theoretical-justification-of-neural-networks/stack-cantor-dust-story.html)

### 4. Pollack, Bifurcations, and Fractal Hidden States

But before that proof was nailed down, there was already fascinating work pointing in the same direction.  Pollack's [The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers) is the paper that really makes the story feel alive.  He traced out the trajectories of hidden states in recurrent nets as they learned formal languages, and found abrupt qualitative changes in behavior: networks that had only managed short strings would suddenly begin handling much longer ones, including strings beyond the training range.  He treated these as "aha moments," which is exactly the right phrase.

This is also the point where the technical discussion becomes genuinely fun.  We are no longer just proving an abstract capability theorem.  We are watching a learning system pass through qualitative changes, and the geometry of those changes starts to matter.

That connection between recurrent nets and discrete dynamical systems exhibiting chaotic behavior is magnificent. You can say that AI gets some of its power from chaos, and that is not just poetry.  Pollack was not just reporting better accuracy; he was noticing that the state-space trajectories themselves were beginning to take on fractal structure.

That is also where the "chaos" starts to become more than a metaphor: it is the system's ability to move through that intricate structure in a meaningful way.  The appeal of Pollack's paper is that he does not merely borrow language from dynamics.  He treats the network as a dynamical system and then finds evidence that the dynamics really are doing computational work.

What is so striking is that Pollack really does say the strong version. In the abstract, he writes that "a small weight adjustment causes a 'bifurcation' in the limit behavior of the network" and that this phase transition corresponds to the onset of generalization to "arbitrary-length strings." He also says the architecture appears capable of generating nonregular languages by exploiting "fractal and chaotic dynamics." Later he makes the wonderfully blunt remark that "a discrete dynamical system is just an iterative computation." And the paper does not leave the idea at the level of metaphor: when discussing parenthesis balancing, he says it is mathematically possible to embed an "infinite state machine" in a dynamical recognizer, with a state space built from fractal self-similarity. That is exactly the kind of claim that made this line of thought hard for me to forget.

For this pass I backed away from the hand-programmed attractor and returned to a simpler training story.  The runtime architecture is now a small `torch.RNN` with `tanh` units, `2` layers, and width `4`, trained on the ordinary balanced-parentheses language rather than the earlier single-block variant.  The checkpoints tell a cleaner shock narrative: a genuinely random start, a random-baseline phase, a phase that introduces off-by-one counterexamples, and then a broader shock phase that adds valid-prefix and balanced-invalid strings on top.

The important change is that the training distribution is resampled every epoch.  Phase 1 uses only class-balanced random task data: half valid balanced strings and half random invalids.  Phase 2 sharply changes the mix to half random and half off-by-one counterexamples.  Phase 3 changes it again, splitting attention evenly across random strings, off-by-one strings, valid-prefix strings, and balanced-invalid strings at lengths ten, twenty, and thirty.  I also let the later phases run longer and switched to a decaying learning-rate schedule so the network can absorb the shocks without simply thrashing forever.  The held-out evaluation sets stay separate and deterministic, so the visible motion is really about the shocks in the training distribution rather than eval leakage.

![Accuracy and probe responses along phased torch.RNN training checkpoints.](/blog-assets/theoretical-justification-of-neural-networks/rnn-training-story.png)

*Story of the figure: the top row plots held-out accuracy at lengths ten, twenty, thirty, and fifty over actual training checkpoints, now with a lighter stroke so the phase changes read more clearly.  The middle row isolates the three counterexample families driving the shocks: off-by-one strings, valid-prefix strings, and balanced-invalid strings.  The bottom row uses a fixed pool of 128 length-10 probes, balanced across valid controls and those same three invalid families.  Its vertical axis is still expressed in sigma units, but with a boundary-zoomed transform so the interesting motion near the decision line is easier to see.  Green means a string is currently handled correctly as valid, yellow means it is correctly rejected as invalid, and red means the recognizer is wrong at that checkpoint; the line dashes distinguish the probe families.*

[Interactive training story chart](/blog-assets/theoretical-justification-of-neural-networks/rnn-training-story.html)

What I especially like here is that the phases really do different jobs.  The random baseline gives the network a simple initial heuristic.  The off-by-one phase shocks that heuristic directly.  And the final mixed phase asks whether the repair survives once valid-prefix and balanced-invalid cases are introduced as well.

![Canonical hidden-state traces for the phased torch.RNN in a shared 2D PCA map.](/blog-assets/theoretical-justification-of-neural-networks/rnn-transition-traces.png)

*Story of the figure: the rows now show three literal strings at four checkpoints: random initialization, after the random baseline, after the off-by-one shock, and after the final mixed shock phase.  One column is a valid control, one is an off-by-one shock case, and one is a valid-prefix repair case.  The state space is shown in an oblique 2D PCA view: mostly `PC1` and `PC2`, but tilted slightly with `PC3` so important separations are not flattened away.  The translucent green ellipse is the projected image of the acceptance ball in hidden-state space, so the main geometric question is simple: does the trace finish inside it?  The traces themselves are colored by their status at that row: green for valid and accepted, yellow for invalid and rejected, red for mistakes.*

[Interactive trace figure](/blog-assets/theoretical-justification-of-neural-networks/rnn-transition-traces.html)

A compact way to describe the machine is this.  The acceptance rule is uniform across all checkpoints: accept exactly when the final hidden state lands inside a fixed-radius neighborhood around an anchor point in hidden-state space.  Early in training, the traces mostly tell a cheap baseline story.  After the off-by-one shock, the network starts to separate a failure family that the baseline does not naturally organize.  And in the final mixed phase the interesting question is whether that repair remains stable once the training distribution becomes broader again.

### 5. Wrap-Up

So for me, that is the theoretical justification.  Feedforward networks are already broad enough to approximate an enormous class of functions.  Recurrent networks go further and cross into general computation.  And once you notice that the price of that power is hidden structure, precision, and opacity, the conversation naturally starts drifting away from engineering and toward dynamics, complexity, and interpretation.

That is enough, I think, to justify real attention from anyone who likes theory.  Even if one turned out to dislike most present-day AI products, these are still beautiful and slightly unsettling mathematical objects.  The more philosophical story begins when we ask what it means to live with them.  But that is really a second post.

---
References:

- Classic paper on universal approximation: [Cybenko - Approximation by Superpositions of a Sigmoidal Function](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf)
- Turing-completeness result for recurrent nets: [Siegelmann Sontag 1992 - On The Computational Power Of Neural Nets](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf)
- Pollack on dynamical recognizers, phase transitions, and fractal state spaces: [Pollack 1991 - The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers)

[^precision]: A convenient model is to map a binary stack `a = (a_1, a_2, ...)`, with `a_i in {0,1}`, to the real number `q(a) = sum_{i=1}^{infty} (2a_i + 1) 4^{-i}`.  Using two stacks gives a point `(q(a), q(b)) in [0,1]^2`, and the odd base-4 digits force the image into a Cantor-dust subset of the square.  The rendered picture in the article only shows a finite depth of that construction, but the Turing-completeness story needs the same self-similar nesting to continue indefinitely, which is exactly where the infinite-precision requirement comes from.
