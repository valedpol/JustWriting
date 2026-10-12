export function initialPublicationAnchor(publication) {
  return { publicationId: publication.publicationId, userId: publication.userId,
    sourceType: publication.source.sourceType, sourceId: publication.source.sourceId,
    sourceRevision: publication.source.sourceRevision, coordinateVersion: publication.source.coordinateVersion,
    status: 'attached', range: { ...publication.source.range } }
}

export function attachedLiveRange(publication, revision) {
  const anchor = publication.liveAnchor
  return anchor?.status === 'attached' && anchor.publicationId === publication.publicationId &&
    anchor.userId === publication.userId && anchor.sourceType === publication.source.sourceType &&
    anchor.sourceId === publication.source.sourceId && anchor.coordinateVersion === 1 &&
    (revision === undefined || anchor.sourceRevision === revision) ? anchor.range : null
}
