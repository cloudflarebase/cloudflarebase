import journal from './meta/_journal.json';
import m0000 from './0000_worried_grim_reaper.sql';
import m0001 from './0001_real_bastion.sql';
import m0002 from './0002_stiff_daredevil.sql';
import m0003 from './0003_reflective_tinkerer.sql';

export default {
	journal,
	migrations: {
		m0000,
		m0001,
		m0002,
		m0003,
	},
};
