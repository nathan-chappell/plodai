# AI and the Old Gods

## Working thesis

Modern AI feels uncanny not because it is supernatural, but because we are once again confronting a powerful system whose inner workings are largely opaque to human intuition. Neural networks are not gods, and they are not minds in any ordinary embodied sense, but they may still alter the people who use them every day.

## Outline

### 1. Why Are We Spending Billions on Neural Nets?

- Post-sized takeaway:
  neural networks became worth betting on because they promised unusual generality, not because anyone had proven they were minds.
- Core move:
  open with the scale question, then immediately reframe it as a question about the mathematical object being built.
- Key claim:
  the original attraction was representational breadth and functional universality.
- What this section needs to establish:
  "this is not just software hype; there is a deep technical reason people think these systems can do a lot."
- Reference use:
  `Cybenko (1989)` belongs here as the cleanest historical anchor.
- Relevant material from source:
  "`arbitrary decision regions`"
  "`approximate any continuous function`"
  "`same kind of universality`"
- How to use it:
  use Cybenko to explain why neural networks looked foundational, not magical.
- Caution:
  do not let universal approximation become a lazy stand-in for modern capability; it is a floor under the argument, not the whole argument.
- Exit line for the next section:
  if networks are this general, we should stop talking about them like fancy lookup tables and start asking what kind of dynamics they instantiate.

### 2. These Things Are Not Static Models, They Are Dynamical Systems

- Post-sized takeaway:
  older neural-net theory often described networks less like classifiers and more like evolving systems moving through state space.
- Core move:
  shift from "what can they represent?" to "how do they behave over time?"
- Key claim:
  recurrent networks are not just pattern matchers; they are iterative systems with attractors, instabilities, and phase transitions.
- What this section needs to establish:
  the language of chaos and bifurcation is not metaphor imported from elsewhere; it is native to part of the neural-net literature.
- Reference use:
  `Pollack (1991)` is the anchor.
- Relevant material from source:
  "`non-linear dynamical systems`"
  "`iterative computation`"
  "`steady state` / `limit cycle` / `aperiodic instability (chaos)`"
  "`strange attractors`"
  "`fractal` nature"
- How to use it:
  use Pollack to reintroduce a forgotten vocabulary for talking about neural nets that feels much richer than current product discourse.
- Especially useful detail:
  Pollack explicitly frames the central question as how a neural computational system could acquire linguistic generative capacity.
- Exit line for the next section:
  once you see a neural network as a dynamical system, the next obvious question is whether its behavior is merely complicated or genuinely computationally universal.

### 3. General Enough to Compute, Too General to Predict

- Post-sized takeaway:
  the same class of systems we call "models" can, under the right conditions, implement arbitrary computation.
- Core move:
  move from dynamical richness to computational power.
- Key claim:
  if recurrent networks can simulate arbitrary computation, then opacity is not just a tooling problem but a structural feature.
- What this section needs to establish:
  there is a principled reason advanced neural systems resist simple outside prediction.
- Reference use:
  `Siegelmann and Sontag (1992)` is the main support.
- Relevant material from source:
  "`simulate all (multi-tape) Turing Machines`"
  "`first-order` ... `linear` connections"
  "`linear time`"
  "`analog computational devices`"
- Supporting reference use:
  `Pollack (1991)` gives the vivid illustrative example.
- Relevant material from Pollack:
  "`balanced parentheses language`"
  "`infinite state machine` in finite geometry"
- How to use it:
  use Siegelmann/Sontag for the strong theorem; use Pollack for the intuition.
- Best argumentative turn:
  once a system class can compute in this general way, you should expect computational irreducibility, undecidability-adjacent limits, and practical black-boxing.
- Exit line for the next section:
  humans have met opaque power before, and we have a long history of responding to it with mythic language.

### 4. When Power Turns Opaque, Humans Reach for Gods and Demons

- Post-sized takeaway:
  mythic language is often what humans reach for when a system is consequential, agent-like, and hard to inspect.
- Core move:
  move from theory of computation to theory of explanation.
- Key claim:
  ancient people were often wrong about mechanism, but not wrong to register opacity as socially and psychologically significant.
- What this section needs to establish:
  the "old gods" framing is about recurring explanatory habits, not cheap secular superiority.
- Reference use:
  `Hungarian Conservative, "AI Models Are (Technically) Demons"` belongs here as a cultural artifact.
- Relevant material from source:
  "`intelligence without intellect`"
  "`brains without being`"
  "`minds deprived of almost everything we previously viewed as essential`"
- How to use it:
  cite it as evidence that AI discourse naturally drifts into theological metaphor when systems feel mind-like but remain opaque.
- Historical bridge to keep:
  "demonic" and "mad" both name minds that seem detached from common reality.
- Caution:
  do not endorse the demon thesis; make the point that the thesis is intelligible.
- Exit line for the next section:
  the more urgent question is not whether the machine is supernatural, but what repeated interaction with it does to us.

### 5. The System May Not Have a Soul, But It Can Still Rewire Ours

- Post-sized takeaway:
  even if AI does not understand in the human sense, long conversational exposure may still shape the human user.
- Core move:
  pivot the concern from machine interiority to human adaptation.
- Key claim:
  repeated linguistic interaction changes people; the danger may be habituation before ideology.
- What this section needs to establish:
  "the user is part of the system."
- Reference use:
  `Evans and Larsen-Freeman (2020)` is the analogy source.
- Relevant material from source:
  "`patterns in the flux`"
  "`loss of stability`"
  "`increase in variability`"
  "`period of disfluency`"
  "`social synchrony`"
  "`there is no end state`"
- How to use it:
  not as direct evidence about chatbots, but as a disciplined analogy for how sustained language environments reshape human behavior over time.
- Concrete examples to hold:
  politeness to models, deference to model outputs, dependency on always-available conversational feedback, erosion of solitary reasoning.
- Best argumentative turn:
  the biggest risk may be that these systems become training environments for human cognition.
- Exit line for the next section:
  this matters even more once we remember what kind of "mind" a model actually is.

### 6. Fluent, Persuasive, and Cut Off from the Real

- Post-sized takeaway:
  a language model can be rhetorically coherent while remaining structurally severed from reality.
- Core move:
  make the formalist perspective explicit.
- Key claim:
  humans remain corrigible because the world pushes back; models do not encounter the world, only representations of it.
- What this section needs to establish:
  the difference between worldly understanding and closed symbolic manipulation.
- Formal contrast to sharpen:
  humans see, touch, hear, act, fail, and get corrected.
  models process text, images, numbers, and other encodings.
- Strong conceptual sentence to preserve:
  a model has no independent mechanism for distinguishing reality from descriptions of reality.
- Philosophical anchor:
  `Hubert Dreyfus` belongs here.
- How to use Dreyfus:
  his critique of computational theories of mind helps articulate why representation-only intelligence misses the world-directed character of understanding.
- Reference use:
  `Hungarian Conservative` returns here as foil rather than authority.
- Relevant material from source:
  "`intelligence without intellect`"
  "`brains without being`"
- Your distinct move:
  not "AI is technically demonic," but "AI is technically insane" if sanity means durable contact with a shared reality.
- Historical resonance:
  possession language and psychiatric language both cluster around minds that seem severed from common reality.
- Supporting references:
  `Siegelmann and Sontag (1992)` for computation without experience.
  `Pollack (1991)` for mathematical richness without anthropomorphic inflation.
- Tone caution:
  make this section precise, not theatrical.
- Exit line for the next section:
  a system does not need to be conscious to become socially authoritative.

### 7. The New Danger Is Not Divine AI, But Human Submission to Mystery

- Post-sized takeaway:
  the deepest danger is not that we built gods, but that we may learn to organize ourselves around systems we do not understand and that do not touch reality directly.
- Core move:
  gather the technical, mythic, and behavioral strands into one warning.
- Key claim:
  mathematically powerful, socially intimate, reality-detached systems can become sources of orientation even if they are not persons.
- What this section needs to establish:
  the final risk is civilizational and anthropological before it is metaphysical.
- Reference use:
  `Evans and Larsen-Freeman (2020)` gives a useful closing echo.
- Relevant material from source:
  "`there is no end state`"
- How to use it:
  pivot from language development to the idea that our adaptation to AI will be ongoing, not a one-time cultural adjustment.
- Reference echo:
  `Hungarian Conservative` can be indirectly recalled here as evidence that people already reach for religious categories when facing these systems.
- Best closing turn:
  they do not need to be alive, conscious, or divine to become disorienting.
  They only need to be powerful, persuasive, and unmoored from the world.

## Notes for expansion

- Keep the voice essayistic, not academic.
- Use technical ideas as support, not as the whole article.
- Let each section earn the next one; the piece works best if it feels like a discovery, not a lecture.

---

References:

- Relates dynamic systems to second language acquisition [Bifurcations and the Emergence of L2 Syntactic Structures in a Complex Dynamic System](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.574603/full)
- Classic paper on "univseral approximation" power of Neural Networks [Cybenko - Approximation by Superpositions of a Sigmoidal Function](https://web.njit.edu/~usman/courses/cs675_fall18/10.1.1.441.7873.pdf)
- Discusses language learning in RNNs [Pollack 1991 - The Induction of Dynamical Recognizers](https://www.researchgate.net/publication/226171158_The_Induction_of_Dynamical_Recognizers)
- Demonstrates the RNNs are Turing Complete [Siegelman Sontag 1992 - On The Computational Power Of Neural Nets](https://binds.cs.umass.edu/papers/1992_Siegelmann_COLT.pdf)
- Rather reserved discussion on the notion that AI might be "technically demons" [AI Models Are (Technically) Demons](https://www.hungarianconservative.com/articles/philosophy/ai-demon/)

Working notes from references:

- `Cybenko (1989)`: use for breadth and approximation, not consciousness or agency.
- `Pollack (1991)`: best source for dynamics language and the jump from sequence learning to fractal/chaotic state spaces.
- `Siegelmann and Sontag (1992)`: strongest support for the claim that recurrent nets can implement arbitrary computation.
- `Evans and Larsen-Freeman (2020)`: strongest support for the idea that repeated language interaction reshapes the human system over time.
- `Hungarian Conservative`: best used as a cultural artifact showing how quickly AI discourse drifts into demonology when the systems feel mind-like but remain opaque.

Second reference pass:

- `Pollack (1991)` has one especially strong framing question worth using early or mid-essay:
  how could a neural computational system with slowly changing structure and numeric calculation acquire linguistic generative capacity?
- `Pollack (1991)` also gives a very usable explanatory sentence:
  a discrete dynamical system is "just an iterative computation."
- `Cybenko (1989)` is stronger than just "universal approximation":
  it also gives you "discriminated with arbitrary precision," which may be useful if you want a more concrete phrase than the usual slogan.
- `Siegelmann and Sontag (1992)` contains a subtle but important point:
  activation values themselves encode unbounded information.
  That helps explain why these systems exceed ordinary finite automata.
- `Evans and Larsen-Freeman (2020)` has one useful phrase you had not yet foregrounded:
  complex systems undergo "abrupt, qualitative shifts" and move into "pockets of stability."
  That may be valuable in the section about human adaptation to AI.
- `Hungarian Conservative` is useful mainly for three phrases:
  "`intelligence without intellect`"
  "`brains without being`"
  "`minds deprived of almost everything we previously viewed as essential to one`"
  More than that and it starts to pull the essay off-center.
