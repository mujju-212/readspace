# Python Basics — Course Notes

> Unit 1 · rewritten after the Tuesday lecture. Ask sir about Q4 in the problem set.

## Variables and types

Python is dynamically typed, but it helps to keep the type table handy:

| Type | Example | Mutable? |
| --- | --- | --- |
| `int` | `42` | no |
| `float` | `3.14` | no |
| `str` | `"notes"` | no |
| `list` | `[1, 2, 3]` | **yes** |
| `dict` | `{"a": 1}` | **yes** |
| `tuple` | `(1, 2)` | no |

## Functions

```python
def grade(mark: int) -> str:
    """Map a mark to a letter grade."""
    if mark >= 90:
        return "S"
    elif mark >= 75:
        return "A"
    elif mark >= 60:
        return "B"
    return "C"

students = {"Mujju": 88, "Aisha": 92, "Ravi": 64}
result = {name: grade(m) for name, m in students.items()}
print(result)  # {'Mujju': 'A', 'Aisha': 'S', 'Ravi': 'B'}
```

## Comprehensions — the three patterns

```python
squares   = [n * n for n in range(10)]          # list
lookup    = {word: len(word) for word in words} # dict
only_even = {n for n in numbers if n % 2 == 0}  # set
```

## Study checklist

- [x] Setup Python + VS Code
- [x] Variables, types, f-strings
- [ ] List/dict comprehensions — redo exercise 3
- [ ] File I/O (`with open(...)`)
- [ ] OOP: classes, `__init__`, methods
- [ ] Practice: solve 5 problems on arrays

## Common mistakes

1. Mutating a list while iterating over it.
2. Forgetting that `input()` returns a **string**.
3. Shadowing built-ins (`list = [1, 2]` — don't).
