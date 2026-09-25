import type { CharacterState } from '../../domain/Character';

export default function LearnedSkills({
  character,
  developer,
}: {
  character: CharacterState;
  developer: boolean;
}) {
  const tree = character.learnedSkills;
  return (
    <section className="learned-skills" aria-label="Learned skill tree">
      <div className="section-caption">
        <div>
          <h3>Learned skills</h3>
          <p>Unlocked abilities, upgrade ranks and passives. Active abilities are listed below.</p>
        </div>
        <span className="tag neutral">READ ONLY</span>
      </div>
      {tree ? (
        <>
          <div className="learned-summary">
            <strong>
              {tree.nodes.length} / {tree.totalNodes} nodes learned
            </strong>
            {tree.nodes.length === tree.totalNodes && (
              <span className="tag success">ALL SKILLS UNLOCKED</span>
            )}
          </div>
          {tree.nodes.length ? (
            <div className="learned-skills-grid">
              {[...tree.nodes]
                .sort((a, b) =>
                  (a.ability ?? a.passive ?? a.effect)!.label.localeCompare(
                    (b.ability ?? b.passive ?? b.effect)!.label,
                  ),
                )
                .map((node) => (
                  <div className="learned-skill" key={node.nodeIndex}>
                    <span className="tag neutral">
                      {node.ability ? 'ABILITY' : node.passive ? 'PASSIVE' : 'EFFECT'}
                    </span>
                    <div>
                      {[node.ability, node.passive, node.effect]
                        .filter((ref) => ref !== undefined)
                        .map((ref) => (
                          <div key={ref.index}>
                            <strong>{ref.label}</strong>
                            {developer && (
                              <code>
                                {ref.name} · #{ref.index}
                              </code>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="inline-note">No learned skill nodes are recorded for this soldier.</p>
          )}
        </>
      ) : (
        <p className="inline-note">
          The learned skill tree is unavailable for this save layout. Active abilities below do not
          show every unlocked skill.
        </p>
      )}
    </section>
  );
}
