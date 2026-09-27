import RegionDemo from './RegionDemo';

/*
 * A server component with no state of its own: the whole example lives in the client
 * component below. The split is deliberate — the library attaches to a real DOM node,
 * which only exists on the client, so the boundary has to be explicit.
 */
export default function Page() {
  return <RegionDemo />;
}
