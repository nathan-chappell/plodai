# AI and the Old Gods

### 1. Theoretical Justification Is Not Optional

"This is computer science, so the proofs aren't unimportant."

When I started studying neural networks mathematically, one of my first questions was: why am I studying these things at all? Eventually I learned about universal approximation, for example [Cybenko's theorem](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf), though there are simpler and more illustrative proofs for narrower classes of activations. Then the plot thickens in [Siegelmann and Sontag](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf), where recurrent neural nets are shown to be Turing complete. It is this argument, and the lead-up to it, that first made a certain parallel feel hard to ignore.

Universal approximation, very roughly, is the statement that a neural network from an appropriate class can uniformly approximate any continuous function on a compact set. That is not the whole modern AI story, but it is a serious kind of theoretical justification. If you are going to launch a mass engineering project around a machine architecture, it helps to know that architecture is universal in a mathematically meaningful sense. Siegelmann and Sontag push the point further: recurrent nets are not merely flexible approximators, but universal computational devices in principle. Those two ideas together go a long way toward explaining why neural networks stopped looking like a niche curiosity and started looking like a general machine architecture.

### 2. Computation as Dynamical Systems: Emergent Intelligence from Deterministic Chaos

One of the most memorable papers I ever read was [Pollack](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers). In it, he describes experiments with recurrent nets by mapping the hidden state spaces they traverse while learning formal languages. The loss on long strings would suddenly change when the networks went from recognizing only short strings to recognizing arbitrarily long ones. He treated this as an "aha moment," which is already a wonderful phrase for it. And it was Pollack who noticed that after these moments, the state-space traversals began to look fractal.

That connection between recurrent nets and discrete dynamical systems exhibiting chaotic behavior is magnificent. You can say that AI gets some of its power from chaos, and that is not just poetry. In the arguments and constructions, the data structures really do get embedded as fractals.[^precision]

That is also where the "chaos" starts to become more than a metaphor: it is the system's ability to move through that intricate structure in a meaningful way.

What is so striking is that Pollack really does say the strong version. In the abstract, he writes that "a small weight adjustment causes a 'bifurcation' in the limit behavior of the network" and that this phase transition corresponds to the onset of generalization to "arbitrary-length strings." He also says the architecture appears capable of generating nonregular languages by exploiting "fractal and chaotic dynamics." Later he makes the wonderfully blunt remark that "a discrete dynamical system is just an iterative computation." And the paper does not leave the idea at the level of metaphor: when discussing parenthesis balancing, he says it is mathematically possible to embed an "infinite state machine" in a dynamical recognizer, with a state space built from fractal self-similarity. That is exactly the kind of claim that made this line of thought hard for me to forget.

### 3. Complexity and Chaos: The New Gods and the Old

Complexity seems to be a double-edged sword. On one side, it blocks us: there are hard limits on what can be efficiently solved, predicted, or decided. On the other, it provides an endless supply of strange new mechanisms for solving difficult problems at all. Chaos is similar. At first glance it looks like terror. But in the old pantheon, Chaos was also generative: the primordial source from which everything else emerged. That comparison may be more apt than we like to admit.

#### Old Names, Same Mystery

What I found funny, while trying to outline this, was how often AI explanations would drift into the same story about "the ancients" attributing things like weather or fate to gods because they did not understand the mechanism.

I would say they did not necessarily get the mechanism wrong. When people say that "the Lord works in mysterious ways," or that something beyond human comprehension is at work, they may be describing a real feature of the world as encountered from within a different paradigm. Once our systems are powerful enough for arbitrary computation, there are properties of them that cannot be algorithmically determined. To some extent they really are beyond full comprehension.

In Kuhn's sense, this feels less like replacing old explanations with better ones than changing what counts as an explanation in the first place. Calling something a "complex system" is real progress, but it is not the same thing as making it transparent. We have named the difficulty more precisely. We have not dissolved it. Starting with the tradition kicked open by Godel, the good news is that this territory is fascinating. The bad news is that part of it is genuinely hopeless.

#### The Demonic Question

So then: are AI demonic? It is a question I have seen thrown around, and I genuinely liked Peter Caddle's short [Hungarian Conservative essay](https://www.hungarianconservative.com/articles/philosophy/ai-demon/) because it makes several parallels I wanted to make myself. He describes present-day AI as "intelligence without intellect" and "brains without being," which fits quite naturally into my own formalist conception of these machines.

By "formalist" here I mean something fairly simple: at bottom, I take AI systems to be symbol-manipulation devices. Very powerful ones, yes, but still systems operating over representations rather than over lived contact with the world. These systems do not have experience, and therefore do not have any independent connection to reality. They are translators among symbols, correlations, and prompts.

That is why I think the theological comparison is more interesting than it first sounds. "Demonic possession" is often treated as though it were simply a pre-modern misunderstanding of psychological disturbance. But if a mind can be called sane only insofar as it remains corrigible by reality, then a system cut off from reality and operating only over representations lacks exactly that corrective relation. If sanity requires even a minimal ability to discriminate reality from mere descriptions of reality, then I think these systems are, in that narrow technical sense, insane. More on that in a moment.


### 4. It Does Not Need a Mind To Rewire Yours

Somehow I found myself reading [Evans and Larsen-Freeman](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.574603/full), a paper on second-language acquisition through the lens of complex systems. On paper that sounds like an odd detour. In practice it ended up fitting the theme almost perfectly.

What the paper makes unusually clear is that learning a second language does not look like smooth linear accumulation. Their learner begins in a fluent but contextually wrong attractor state: forms like "before to talk" and "before to tell" come out smoothly because they are stabilized by the learner's first language. The paper explicitly calls this kind of state a "pocket of stability." Then the old attractor destabilizes. Dysfluency appears. Hesitations and self-repairs show up. A new form, "before starting the class," eventually emerges, but not as a neat replacement. For a while several forms coexist in competition before a new attractor wins out. The paper summarizes the transition cleanly: bifurcations involve "loss of stability, an increase in variability, and a period of disfluency."

That matters because learning a language is not merely adding a rule to a notebook. It is the physical reorganization of a system. If that is what language interaction does to a brain, then it is hard for me to believe that long, repeated interaction with AI will not do the same. We are not just consulting a tool. We are allowing a reality-detached symbolic system to participate in shaping our habits of speech, thought, and attention.

Even the small question of politeness matters here. I do not care much whether saying "please" helps the model. I care whether habitual contempt, command, flattery, or emotional dependence changes the user. My suspicion is that AI may prove vastly more addictive than the phone, not because it is brighter, but because it talks back. And if our own minds are dynamical systems, then the obvious question is not only what AI can do, but how much repeated contact with something technically insane can alter the stability of our own grip on what is real.

### 5. Wrap-Up: The Danger Is Not That Machines Think Like Us

I started with theory because I wanted to know why anyone should take neural networks seriously in the first place. That led to universal approximation, Turing completeness, Pollack's strange fractal state spaces, and then to a more practical thought: if these systems are powerful in the ways the theory suggests, then some of their opacity may simply come with the territory. From there the older language of mystery, gods, demons, and possession stopped feeling entirely quaint to me. And once I put that next to the language-learning paper, the question became not just "what are these things?" but also "what will regular interaction with them do to us?"

I could easily be wrong about parts of this. I am not trying to present a finished doctrine here, just following a mathematical thread until it started touching questions that seemed worth paying attention to. But I do think there is at least a real possibility that the danger of AI is not that machines will begin thinking like us, but that we may, in some ways, begin thinking more like them.

Touching grass might unironically be good advice.

---
References:

- Classic paper on universal approximation: [Cybenko - Approximation by Superpositions of a Sigmoidal Function](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf)
- Turing-completeness result for recurrent nets: [Siegelmann Sontag 1992 - On The Computational Power Of Neural Nets](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf)
- Pollack on dynamical recognizers, phase transitions, and fractal state spaces: [Pollack 1991 - The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers)
- Evans and Larsen-Freeman on bifurcations in second-language development: [Bifurcations and the Emergence of L2 Syntactic Structures in a Complex Dynamic System](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.574603/full)
- Peter Caddle's essay used for the "technically demons" comparison: [AI Models Are (Technically) Demons](https://www.hungarianconservative.com/articles/philosophy/ai-demon/)

[^precision]: One convenient model is to map a binary stack `a = (a_1, a_2, ...)`, with `a_i in {0,1}`, to the real number `x(a) = sum_{i=1}^{infty} a_i 2^{-i}`. Using two stacks gives a point `(x(a), x(b)) in [0,1]^2`. In this way one obtains two Cantor-like coordinate sets, and hence a fractal subset of the square on which symbolic structure can be encoded geometrically. The "infinity" has not disappeared; it has been transferred into the arbitrarily fine precision required to specify the point.
