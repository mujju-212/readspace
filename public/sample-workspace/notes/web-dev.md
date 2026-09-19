# Web Development Notes

## How a page reaches the browser

```
URL  →  DNS lookup  →  TCP/TLS  →  HTTP request
     →  server responds (HTML)  →  browser parses
     →  fetches CSS/JS/images  →  render tree  →  paint
```

## The three languages

| Layer | Language | Job |
| --- | --- | --- |
| Structure | HTML | meaning & content |
| Presentation | CSS | layout & style |
| Behaviour | JavaScript | interactivity |

## React mental model

```jsx
function Greeting({ name }) {
  return <h2>Hello, {name}!</h2>;
}

// state changes re-run the function, React updates only what changed
export default function App() {
  const [count, setCount] = React.useState(0);
  return (
    <main>
      <Greeting name="Mujju" />
      <button onClick={() => setCount(count + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}
```

### Rules worth memorising

1. Components are functions returning JSX.
2. Props flow **down**, events flow **up**.
3. `useEffect` is for synchronising with things outside React.
4. Keys in lists must be stable — never the array index if you reorder.

## HTTP status codes you'll actually see

- `200` OK
- `301` moved permanently
- `404` not found
- `500` server error
