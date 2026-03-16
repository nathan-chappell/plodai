# AI and the Old Gods

### 1. Theoretical Justification Is Not Optional

"This is computer science, so the proofs aren't unimportant."

When I started studying neural networks mathematically, one of my first questions was: why am I studying these things at all? Eventually I learned about universal approximation, for example Cybenko's theorem, though there are simpler and more illustrative proofs for narrower classes of activations. Then the plot thickens in Siegelmann and Sontag, where recurrent neural nets are shown to be Turing complete. It is this argument, and the lead-up to it, that first made a certain parallel feel hard to ignore.

Universal approximation, very roughly, is the statement that a neural network from an appropriate class can uniformly approximate any continuous function on a compact set. That is not the whole modern AI story, but it is a serious kind of theoretical justification. If you are going to launch a mass engineering project around a machine architecture, it helps to know that architecture is universal in a mathematically meaningful sense. Siegelmann and Sontag push the point further: recurrent nets are not merely flexible approximators, but universal computational devices in principle. Those two ideas together go a long way toward explaining why neural networks stopped looking like a niche curiosity and started looking like a general machine architecture.

### 2. Computation as Dynamical Systems: Emergent Intelligence from Deterministic Chaos

One of the most memorable papers I ever read was Pollack. In it, he describes experiments with recurrent nets by mapping the hidden state spaces they traverse while learning formal languages. The loss on long strings would suddenly change when the networks went from recognizing only short strings to recognizing arbitrarily long ones. He treated this as an "aha moment," which is already a wonderful phrase for it. But the part that really stuck with me is that after these moments, the state-space traversals began to look fractal.

That connection between recurrent nets and discrete dynamical systems exhibiting chaotic behavior is magnificent. You can say that AI gets some of its power from chaos, and that is not just poetry. In the arguments and constructions, the data structures really do get embedded as fractals. One easy way to picture the idea is to imagine embedding two infinite stacks of `{0,1}` into `R^2`. On the boundaries of the square you get disconnected dense sets, basically binary dust. We need two infinite stacks to simulate a Turing machine, and in the neural-net story the "infinity" shows up as the infinite precision needed to encode a true fractal rather than a crude approximation. The chaos, then, is not meaningless turbulence. It is the ability to traverse that structure meaningfully.

What is so striking is that Pollack really does say the strong version. In the abstract, he writes that "a small weight adjustment causes a 'bifurcation' in the limit behavior of the network" and that this phase transition corresponds to the onset of generalization to "arbitrary-length strings." He also says the architecture appears capable of generating nonregular languages by exploiting "fractal and chaotic dynamics." Later he makes the wonderfully blunt remark that "a discrete dynamical system is just an iterative computation." And the paper does not leave the idea at the level of metaphor: when discussing parenthesis balancing, he says it is mathematically possible to embed an "infinite state machine" in a dynamical recognizer, with a state space built from fractal self-similarity. That is exactly the kind of claim that made this line of thought hard for me to forget.

### 3. Complexity and Chaos: The New Gods and the Old

Complexity seems to be a double-edged sword. On one side, it blocks us: there are hard limits on what can be efficiently solved, predicted, or decided. On the other, it provides an endless supply of strange new mechanisms for solving difficult problems at all. Chaos is similar. At first glance it looks like terror. But in the old pantheon, Chaos was also generative: the primordial source from which everything else emerged. That comparison may be more apt than we like to admit.

What kept bothering me, while trying to outline this, was how often AI explanations slip into a smug little story about "the ancients" attributing things like weather or fate to gods because they did not understand the mechanism. I had to keep correcting that. No, they did not necessarily get the mechanism wrong. When people say that "the Lord works in mysterious ways," or that something beyond human comprehension is at work, they may be describing a real feature of the world as encountered from within a different paradigm. Once our systems are powerful enough for arbitrary computation, there are properties of them that cannot be algorithmically determined. To some extent they really are beyond full comprehension.

In Kuhn's sense, this feels less like replacing old explanations with better ones than changing what counts as an explanation in the first place. Calling something a "complex system" is real progress, but it is not the same thing as making it transparent. We have named the difficulty more precisely. We have not dissolved it. Starting with the tradition kicked open by Godel, the good news is that this territory is fascinating. The bad news is that part of it is genuinely hopeless.

So, naturally, the next question is: are AI demonic? Maybe not. But it is striking that Peter Caddle's short Hungarian Conservative essay reaches for almost exactly that comparison. He describes present-day AI as "intelligence without intellect" and "brains without being," which I think are provocative phrases in a useful way even if one does not share the article's theological framing. And I think it is worth pointing out that "demonic possession" is often treated as though it were simply a pre-modern misunderstanding of psychological disturbance, when in reality we should be much more cautious than that. We are very good at renaming mysteries.

My own route to a similar conclusion is more formalist than theological. By "formalist" here I mean that I take AI systems, at bottom, to be symbol-manipulation devices: very powerful ones, yes, but still systems operating over representations rather than over lived contact with the world. They have no experience, and therefore no independent connection to reality. They are translators among symbols, correlations, and prompts. So if sanity requires even a minimal ability to discriminate reality from mere descriptions of reality, then I think these systems are, in that narrow technical sense, insane. More on that in a moment.


### 4. It Does Not Need a Mind To Rewire Yours

What I found so compelling in Evans and Larsen-Freeman is how concrete the bifurcation picture becomes. Their learner begins in a fluent but contextually divergent attractor state: forms like "before to talk" and "before to tell" come out smoothly because they are stabilized by the learner's first language. The paper explicitly calls this kind of state a "pocket of stability." Then the old attractor begins to destabilize. Dysfluency appears. Hesitations and self-repairs show up. By week 16 a new, contextually dominant form appears, "before starting the class," but it does not simply replace the old one in a clean linear march. For a while multiple forms coexist in competition, with the system passing through instability before a new attractor wins out. The paper summarizes the transition very cleanly: bifurcations involve "loss of stability, an increase in variability, and a period of disfluency."

That matters because learning a language is not merely adding a rule to a notebook. It is the physical reorganization of a system. If that is what language interaction does to a brain, then it is hard for me to believe that long, repeated interaction with AI will not do the same. We are not just consulting a tool. We are allowing a reality-detached symbolic system to participate in shaping our habits of speech, thought, and attention.

Even the small question of politeness matters here. I do not care much whether saying "please" helps the model. I care whether habitual contempt, command, flattery, or emotional dependence changes the user. My suspicion is that AI may prove vastly more addictive than the phone, not because it is brighter, but because it talks back. And if our own minds are dynamical systems, then the obvious question is not only what AI can do, but how much repeated contact with something technically insane can alter the stability of our own grip on what is real.

### 5. Wrap-Up: The Danger Is Not That Machines Think Like Us

The danger of AI is not that machines will begin thinking like us.

The danger is that we may begin thinking more like them.

If you made it this far, I hope the trip through neural-net theory felt at least a little worthwhile. My closing thought is simple: take care of yourself. Physical health, embodied life, and regular contact with the world are not optional extras. They are part of mental health.

Go touch grass.

---
References:

- Classic paper on universal approximation: [Cybenko - Approximation by Superpositions of a Sigmoidal Function](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf)
- Turing-completeness result for recurrent nets: [Siegelmann Sontag 1992 - On The Computational Power Of Neural Nets](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf)
- Pollack on dynamical recognizers, phase transitions, and fractal state spaces: [Pollack 1991 - The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers)
- Evans and Larsen-Freeman on bifurcations in second-language development: [Bifurcations and the Emergence of L2 Syntactic Structures in a Complex Dynamic System](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.574603/full)
- Peter Caddle's essay used for the "technically demons" comparison: [AI Models Are (Technically) Demons](https://www.hungarianconservative.com/articles/philosophy/ai-demon/)
