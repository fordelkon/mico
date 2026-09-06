function sortByEnabledOrder<T>(items: T[], enabledIds: string[], getId: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const leftEnabledIndex = enabledIds.indexOf(getId(left))
    const rightEnabledIndex = enabledIds.indexOf(getId(right))

    if (leftEnabledIndex >= 0 && rightEnabledIndex >= 0) return leftEnabledIndex - rightEnabledIndex
    if (leftEnabledIndex >= 0) return -1
    if (rightEnabledIndex >= 0) return 1
    return 0
  })
}

export { sortByEnabledOrder }
