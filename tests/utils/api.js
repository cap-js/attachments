class RequestSend {
  constructor(post) {
    this.post = post
  }
  async draftModeActions(
    serviceName,
    entityName,
    id,
    path,
    action,
    isRootCreated = false
  ) {
    if (!isRootCreated) {
      try {
        await this.post(
          `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=true)/${path}.draftEdit`,
          {
            PreserveChanges: true,
          }
        )
      } catch (err) {
        return err
      }
    }
    try {
      await action()
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftPrepare`,
        {
          SideEffectsQualifier: "",
        }
      )
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftActivate`,
        {}
      )
    } catch (err) {
      return err
    }
  }
}

module.exports = {
  RequestSend,
}
