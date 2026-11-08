# Convergence of a reciprocal sequence

This original teaching fixture is included for local testing and a first learning session.

Definition 1. A real sequence $(a_n)_{n\ge1}$ converges to $L\in\mathbb R$ if for every $\varepsilon>0$ there exists $N\in\mathbb N$ such that for every $n\ge N$, $|a_n-L|<\varepsilon$.

Proposition 2. The sequence $a_n=1/n$ converges to zero.

Proof. Let $\varepsilon>0$. By the Archimedean property, choose an integer $N>1/\varepsilon$. For every $n\ge N$ we have

$$\left|\frac1n-0\right|=\frac1n\le\frac1N<\varepsilon.$$

This is precisely the condition in Definition 1, so $1/n\to0$.

Suggested conceptual boundaries: (1) interpreting the quantifiers in the definition; (2) choosing a threshold using the Archimedean property; (3) verifying the bound for the whole tail.
