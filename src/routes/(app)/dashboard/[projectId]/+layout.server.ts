import type { LayoutServerLoad } from './$types';

// The agent pane's open state and split sizes persist in a cookie (written by
// the dashboard layout on resize/toggle) so SSR renders the saved layout
// directly — restoring a resized pane never flashes the default widths.
// Format: "open:70:30" | "closed:70:30".
export const load: LayoutServerLoad = ({ cookies }) => {
	const [state, ...rest] = (cookies.get('cfbase-copilot') ?? '').split(':');
	const sizes = rest.map(Number);
	const layout =
		sizes.length === 2 && sizes.every((size) => Number.isFinite(size) && size >= 15 && size <= 85)
			? sizes
			: null;
	return {
		copilot: {
			open: state !== 'closed',
			layout
		}
	};
};
